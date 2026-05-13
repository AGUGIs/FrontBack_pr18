const express = require('express');
const { nanoid } = require('nanoid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const webpush = require('web-push');

const app = express();
const port = 3000;

// ==================== Секреты и конфигурация ====================
const ACCESS_SECRET = 'access_secret_key_online_store';
const REFRESH_SECRET = 'refresh_secret_key_online_store';
const ACCESS_EXPIRES_IN = '15m';
const REFRESH_EXPIRES_IN = '7d';

// ==================== VAPID-ключи для Push-уведомлений (ПР16) ====================
// Ключи генерируются автоматически при первом запуске и сохраняются в vapid-keys.json
const vapidKeysPath = path.join(__dirname, 'vapid-keys.json');

let VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY;

if (fs.existsSync(vapidKeysPath)) {
  const keys = JSON.parse(fs.readFileSync(vapidKeysPath, 'utf-8'));
  VAPID_PUBLIC_KEY = keys.publicKey;
  VAPID_PRIVATE_KEY = keys.privateKey;
} else {
  // Генерируем новые VAPID-ключи автоматически
  const vapidKeys = webpush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  fs.writeFileSync(vapidKeysPath, JSON.stringify(vapidKeys, null, 2));
  console.log('VAPID-ключи сгенерированы и сохранены в vapid-keys.json');
}

webpush.setVapidDetails(
  'mailto:admin@kastryulamarket.ru',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Хранилище push-подписок (ПР16)
let pushSubscriptions = [];

// ==================== Middleware ====================
app.use(express.json());
app.use(cors({
  origin: function(origin, callback) {
    // Разрешаем все запросы с localhost
    if (!origin || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Middleware для логирования запросов (ПР4)
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] [${req.method}] ${res.statusCode} ${req.path}`);
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      console.log('Body:', req.body);
    }
  });
  next();
});

// ==================== Данные ====================
// Пользователи: { id, email, first_name, last_name, passwordHash, role }
let users = [];

// Товары: { id, title, category, description, price, stock, rating, image }
let products = [
  { id: nanoid(6), title: 'Кастрюля из нержавеющей стали 5л', category: 'Кастрюли', description: 'Универсальная кастрюля из нержавеющей стали с толстым дном для равномерного нагрева. Подходит для всех типов плит, включая индукционные.', price: 3490, stock: 30, rating: 4.7, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTuUcUNbzUpanMPqe5xS80xjf52mlnACgU6Iw&s' },
  { id: nanoid(6), title: 'Чугунная кастрюля с крышкой 3л', category: 'Кастрюли', description: 'Классическая чугунная кастрюля с эмалированным покрытием. Идеальна для тушения, томления и запекания в духовке.', price: 5990, stock: 15, rating: 4.9, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS8gWBRCeI4K7tpTHCfvNq8wzBlE1yVgVgqjg&s' },
  { id: nanoid(6), title: 'Сотейник с антипригарным покрытием 2л', category: 'Сотейники', description: 'Алюминиевый сотейник с многослойным антипригарным покрытием и удобной бакелитовой ручкой. Легкий и практичный.', price: 2190, stock: 45, rating: 4.4, image: 'https://static.insales-cdn.com/images/products/1/175/269246639/1100232_001.jpg' },
  { id: nanoid(6), title: 'Кастрюля-скороварка 6л', category: 'Скороварки', description: 'Скороварка из нержавеющей стали с системой безопасного замка крышки. Готовит блюда в 3 раза быстрее обычной кастрюли.', price: 7890, stock: 12, rating: 4.6, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTVGLn9YIzAk33CWgRnAbSlvbYo4QgNFBXFBA&s' },
  { id: nanoid(6), title: 'Набор кастрюль «Домашний повар» (3 шт)', category: 'Наборы', description: 'Набор из трёх кастрюль (1.5л, 3л, 5л) из нержавеющей стали с мерной шкалой внутри и стеклянными крышками.', price: 6490, stock: 20, rating: 4.8, image: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRewjK0777moKHXg2Q2EUhiNHqSM8UmRdmWbw&s' },
  { id: nanoid(6), title: 'Молочник с двойным дном 1.5л', category: 'Ковши', description: 'Ковш-молочник из нержавеющей стали с капсульным дном. Удобный носик для аккуратного слива. Подходит для индукции.', price: 1790, stock: 55, rating: 4.3, image: 'https://cdn.vseinstrumenti.ru/images/goods/tovary-dlya-ofisa-i-doma/tovary-dlya-doma/5128867/2400x1600/65270491.jpg' },
];

// Хранилище refresh-токенов (ПР9)
const refreshTokens = new Set();

// ==================== Swagger (ПР5) ====================
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Магазина кастрюль «КастрюляМаркет»',
      version: '1.0.0',
      description: 'REST API для управления товарами и пользователями магазина кастрюль с аутентификацией и RBAC',
    },
    servers: [
      { url: `https://localhost:${port}`, description: 'HTTPS-сервер (ПР15)' },
      { url: `http://localhost:${port}`, description: 'HTTP-сервер' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: ['./app.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ==================== Вспомогательные функции ====================

function findProductOr404(id, res) {
  const product = products.find(p => p.id === id);
  if (!product) {
    res.status(404).json({ error: 'Товар не найден' });
    return null;
  }
  return product;
}

function findUserOr404(id, res) {
  const user = users.find(u => u.id === id);
  if (!user) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return null;
  }
  return user;
}

// ==================== JWT-функции (ПР8, ПР9) ====================

function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

function generateRefreshToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES_IN }
  );
}

// ==================== Middleware аутентификации (ПР8) ====================

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }
  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Невалидный или истекший токен' });
  }
}

// ==================== Middleware ролей (ПР11) ====================

function roleMiddleware(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    next();
  };
}

// ==================== Swagger-схемы ====================

/**
 * @swagger
 * components:
 *   schemas:
 *     Product:
 *       type: object
 *       required:
 *         - title
 *         - category
 *         - description
 *         - price
 *       properties:
 *         id:
 *           type: string
 *           description: Уникальный ID товара
 *         title:
 *           type: string
 *           description: Название товара
 *         category:
 *           type: string
 *           description: Категория товара
 *         description:
 *           type: string
 *           description: Описание товара
 *         price:
 *           type: number
 *           description: Цена товара
 *         stock:
 *           type: integer
 *           description: Количество на складе
 *         rating:
 *           type: number
 *           description: Рейтинг товара
 *         image:
 *           type: string
 *           description: URL изображения товара
 *       example:
 *         id: "abc123"
 *         title: "Ноутбук"
 *         category: "Ноутбуки"
 *         description: "Мощный ноутбук"
 *         price: 54990
 *         stock: 15
 *         rating: 4.5
 *         image: "https://example.com/img.jpg"
 *     User:
 *       type: object
 *       required:
 *         - email
 *         - first_name
 *         - last_name
 *         - password
 *       properties:
 *         id:
 *           type: string
 *         email:
 *           type: string
 *         first_name:
 *           type: string
 *         last_name:
 *           type: string
 *         role:
 *           type: string
 *           enum: [user, seller, admin]
 *       example:
 *         id: "xyz789"
 *         email: "ivan@mail.ru"
 *         first_name: "Иван"
 *         last_name: "Иванов"
 *         role: "user"
 *     AuthTokens:
 *       type: object
 *       properties:
 *         accessToken:
 *           type: string
 *         refreshToken:
 *           type: string
 */

// ==================== AUTH маршруты (ПР7, ПР8, ПР9) ====================

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Регистрация пользователя
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - first_name
 *               - last_name
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: ivan@mail.ru
 *               first_name:
 *                 type: string
 *                 example: Иван
 *               last_name:
 *                 type: string
 *                 example: Иванов
 *               password:
 *                 type: string
 *                 example: qwerty123
 *               role:
 *                 type: string
 *                 enum: [user, seller, admin]
 *                 example: user
 *     responses:
 *       201:
 *         description: Пользователь создан
 *       400:
 *         description: Некорректные данные
 *       409:
 *         description: Email уже зарегистрирован
 */
app.post('/api/auth/register', async (req, res) => {
  const { email, first_name, last_name, password, role } = req.body;
  if (!email || !first_name || !last_name || !password) {
    return res.status(400).json({ error: 'Все поля обязательны: email, first_name, last_name, password' });
  }
  const exists = users.some(u => u.email === email);
  if (exists) {
    return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: nanoid(6),
    email: email.trim().toLowerCase(),
    first_name: first_name.trim(),
    last_name: last_name.trim(),
    passwordHash,
    role: role || 'user',
    blocked: false,
  };
  users.push(user);
  res.status(201).json({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
  });
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Вход в систему
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: ivan@mail.ru
 *               password:
 *                 type: string
 *                 example: qwerty123
 *     responses:
 *       200:
 *         description: Успешный вход
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokens'
 *       401:
 *         description: Неверные учетные данные
 */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  }
  const user = users.find(u => u.email === email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Неверные учетные данные' });
  }
  if (user.blocked) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Неверные учетные данные' });
  }
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  refreshTokens.add(refreshToken);
  res.json({ accessToken, refreshToken });
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Обновление пары токенов
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Новая пара токенов
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokens'
 *       401:
 *         description: Невалидный refresh-токен
 */
app.post('/api/auth/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken обязателен' });
  }
  if (!refreshTokens.has(refreshToken)) {
    return res.status(401).json({ error: 'Невалидный refresh-токен' });
  }
  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);
    const user = users.find(u => u.id === payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    refreshTokens.delete(refreshToken);
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    refreshTokens.add(newRefreshToken);
    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    return res.status(401).json({ error: 'Невалидный или истекший refresh-токен' });
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Получение информации о текущем пользователе
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Данные текущего пользователя
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Не авторизован
 */
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.sub);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  res.json({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    blocked: user.blocked,
  });
});

// ==================== PRODUCTS маршруты (ПР2, ПР4, ПР5, ПР8, ПР11) ====================

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Создать новый товар
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - category
 *               - description
 *               - price
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               stock:
 *                 type: integer
 *               rating:
 *                 type: number
 *               image:
 *                 type: string
 *     responses:
 *       201:
 *         description: Товар создан
 *       400:
 *         description: Некорректные данные
 *       401:
 *         description: Не авторизован
 *       403:
 *         description: Доступ запрещён
 */
app.post('/api/products', authMiddleware, roleMiddleware(['seller', 'admin']), (req, res) => {
  const { title, category, description, price, stock, rating, image } = req.body;
  if (!title || !category || !description || price === undefined) {
    return res.status(400).json({ error: 'Поля title, category, description, price обязательны' });
  }
  const newProduct = {
    id: nanoid(6),
    title: title.trim(),
    category: category.trim(),
    description: description.trim(),
    price: Number(price),
    stock: stock !== undefined ? Number(stock) : 0,
    rating: rating !== undefined ? Number(rating) : 0,
    image: image || 'https://via.placeholder.com/300x200?text=Product',
  };
  products.push(newProduct);
  res.status(201).json(newProduct);
});

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Получить список всех товаров
 *     tags: [Products]
 *     responses:
 *       200:
 *         description: Список товаров
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Product'
 */
app.get('/api/products', (req, res) => {
  res.json(products);
});

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Получить товар по ID
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID товара
 *     responses:
 *       200:
 *         description: Данные товара
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Product'
 *       401:
 *         description: Не авторизован
 *       404:
 *         description: Товар не найден
 */
app.get('/api/products/:id', authMiddleware, roleMiddleware(['user', 'seller', 'admin']), (req, res) => {
  const product = findProductOr404(req.params.id, res);
  if (!product) return;
  res.json(product);
});

/**
 * @swagger
 * /api/products/{id}:
 *   put:
 *     summary: Обновить товар по ID
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID товара
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               stock:
 *                 type: integer
 *               rating:
 *                 type: number
 *               image:
 *                 type: string
 *     responses:
 *       200:
 *         description: Обновлённый товар
 *       401:
 *         description: Не авторизован
 *       403:
 *         description: Доступ запрещён
 *       404:
 *         description: Товар не найден
 */
app.put('/api/products/:id', authMiddleware, roleMiddleware(['seller', 'admin']), (req, res) => {
  const product = findProductOr404(req.params.id, res);
  if (!product) return;
  const { title, category, description, price, stock, rating, image } = req.body;
  if (title !== undefined) product.title = title.trim();
  if (category !== undefined) product.category = category.trim();
  if (description !== undefined) product.description = description.trim();
  if (price !== undefined) product.price = Number(price);
  if (stock !== undefined) product.stock = Number(stock);
  if (rating !== undefined) product.rating = Number(rating);
  if (image !== undefined) product.image = image;
  res.json(product);
});

/**
 * @swagger
 * /api/products/{id}:
 *   delete:
 *     summary: Удалить товар по ID
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID товара
 *     responses:
 *       204:
 *         description: Товар удалён
 *       401:
 *         description: Не авторизован
 *       403:
 *         description: Доступ запрещён
 *       404:
 *         description: Товар не найден
 */
app.delete('/api/products/:id', authMiddleware, roleMiddleware(['admin']), (req, res) => {
  const exists = products.some(p => p.id === req.params.id);
  if (!exists) return res.status(404).json({ error: 'Товар не найден' });
  products = products.filter(p => p.id !== req.params.id);
  res.status(204).send();
});

// ==================== USERS маршруты (ПР11) ====================

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Получить список пользователей (только админ)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Список пользователей
 *       403:
 *         description: Доступ запрещён
 */
app.get('/api/users', authMiddleware, roleMiddleware(['admin']), (req, res) => {
  const safeUsers = users.map(u => ({
    id: u.id,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    blocked: u.blocked,
  }));
  res.json(safeUsers);
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Получить пользователя по ID (только админ)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Данные пользователя
 *       404:
 *         description: Пользователь не найден
 */
app.get('/api/users/:id', authMiddleware, roleMiddleware(['admin']), (req, res) => {
  const user = findUserOr404(req.params.id, res);
  if (!user) return;
  res.json({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    blocked: user.blocked,
  });
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Обновить информацию пользователя (только админ)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [user, seller, admin]
 *     responses:
 *       200:
 *         description: Обновлённый пользователь
 */
app.put('/api/users/:id', authMiddleware, roleMiddleware(['admin']), (req, res) => {
  const user = findUserOr404(req.params.id, res);
  if (!user) return;
  const { first_name, last_name, role } = req.body;
  if (first_name !== undefined) user.first_name = first_name.trim();
  if (last_name !== undefined) user.last_name = last_name.trim();
  if (role !== undefined) user.role = role;
  res.json({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    blocked: user.blocked,
  });
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Заблокировать пользователя (только админ)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *     responses:
 *       200:
 *         description: Пользователь заблокирован
 */
app.delete('/api/users/:id', authMiddleware, roleMiddleware(['admin']), (req, res) => {
  const user = findUserOr404(req.params.id, res);
  if (!user) return;
  user.blocked = !user.blocked;
  res.json({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    blocked: user.blocked,
  });
});

// ==================== Push-уведомления (ПР16) ====================

/**
 * @swagger
 * /api/vapid-public-key:
 *   get:
 *     summary: Получить публичный VAPID-ключ
 *     tags: [Push]
 *     responses:
 *       200:
 *         description: Публичный ключ
 */
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

/**
 * @swagger
 * /api/subscribe:
 *   post:
 *     summary: Подписаться на push-уведомления
 *     tags: [Push]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Подписка сохранена
 */
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  const exists = pushSubscriptions.some(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    pushSubscriptions.push(subscription);
  }
  res.status(201).json({ message: 'Подписка сохранена' });
});

/**
 * @swagger
 * /api/unsubscribe:
 *   post:
 *     summary: Отписаться от push-уведомлений
 *     tags: [Push]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               endpoint:
 *                 type: string
 *     responses:
 *       200:
 *         description: Подписка удалена
 */
app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
  res.status(200).json({ message: 'Подписка удалена' });
});

// ==================== Обработчики ошибок ====================

app.use((req, res) => {
  res.status(404).json({ error: 'Маршрут не найден' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ==================== Запуск сервера (ПР15 + ПР16) ====================

const certPath = path.join(__dirname, 'localhost.pem');
const keyPath = path.join(__dirname, 'localhost-key.pem');

let server;
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  server = https.createServer(httpsOptions, app);
} else {
  server = http.createServer(app);
}

// ==================== Socket.IO (ПР16) + Напоминания (ПР17) ====================

// Хранилище активных напоминаний: id -> { timeoutId, text, reminderTime } (ПР17)
const reminders = new Map();

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  console.log('WebSocket: клиент подключён:', socket.id);

  // Обработка события добавления нового товара (ПР16)
  socket.on('newProduct', (product) => {
    io.emit('productAdded', product);

    const payload = JSON.stringify({
      title: 'Новый товар в КастрюляМаркет!',
      body: product.title || 'Добавлен новый товар',
    });

    pushSubscriptions.forEach((sub) => {
      webpush.sendNotification(sub, payload).catch((err) => {
        console.error('Push error:', err.statusCode);
        if (err.statusCode === 410 || err.statusCode === 404) {
          pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
        }
      });
    });
  });

  // Обработка напоминания с отложенной отправкой push (ПР17)
  socket.on('newReminder', (reminder) => {
    const { id, text, reminderTime } = reminder;
    const delay = reminderTime - Date.now();
    if (delay <= 0) return;

    console.log(`Напоминание запланировано: "${text}" через ${Math.round(delay / 1000)} сек.`);

    const timeoutId = setTimeout(() => {
      const payload = JSON.stringify({
        title: 'Напоминание',
        body: text,
        reminderId: id,
      });

      pushSubscriptions.forEach((sub) => {
        webpush.sendNotification(sub, payload).catch((err) => {
          console.error('Push error:', err.statusCode);
          if (err.statusCode === 410 || err.statusCode === 404) {
            pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
          }
        });
      });

      // Рассылаем WebSocket-событие
      io.emit('reminderFired', { id, text });

      reminders.delete(id);
    }, delay);

    reminders.set(id, { timeoutId, text, reminderTime });
  });

  socket.on('disconnect', () => {
    console.log('WebSocket: клиент отключён:', socket.id);
  });
});

// Эндпоинт откладывания напоминания на 5 минут (ПР17)
app.post('/api/snooze', (req, res) => {
  const reminderId = parseInt(req.query.reminderId, 10);

  if (!reminderId || !reminders.has(reminderId)) {
    return res.status(404).json({ error: 'Напоминание не найдено' });
  }

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const newDelay = 5 * 60 * 1000; // 5 минут

  const newTimeoutId = setTimeout(() => {
    const payload = JSON.stringify({
      title: 'Отложенное напоминание',
      body: reminder.text,
      reminderId: reminderId,
    });

    pushSubscriptions.forEach((sub) => {
      webpush.sendNotification(sub, payload).catch((err) => {
        console.error('Push error:', err.statusCode);
        if (err.statusCode === 410 || err.statusCode === 404) {
          pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
        }
      });
    });

    reminders.delete(reminderId);
  }, newDelay);

  reminders.set(reminderId, {
    timeoutId: newTimeoutId,
    text: reminder.text,
    reminderTime: Date.now() + newDelay,
  });

  console.log(`Напоминание ${reminderId} отложено на 5 минут`);
  res.status(200).json({ message: 'Напоминание отложено на 5 минут' });
});

// Запуск
server.listen(port, () => {
  const protocol = fs.existsSync(certPath) ? 'https' : 'http';
  console.log(`${protocol.toUpperCase()}-сервер запущен на ${protocol}://localhost:${port}`);
  console.log(`Swagger UI: ${protocol}://localhost:${port}/api-docs`);
  console.log(`WebSocket: включён на порту ${port}`);
});
