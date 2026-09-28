/**
 * Mock E-commerce & Logistics API Service
 * In-memory data store and business logic for MCP tools.
 */

export interface Product {
  sku: string;
  title: string;
  category: 'smartphones' | 'laptops' | 'audio' | 'wearables' | 'accessories';
  price: number;
  currency: string;
  inStock: boolean;
  stockCount: number;
  warehouse: string;
  description: string;
  specs: Record<string, string>;
}

export interface OrderItem {
  sku: string;
  title: string;
  quantity: number;
  price: number;
}

export interface Order {
  orderId: string;
  clientName: string;
  clientPhone: string;
  status: 'processing' | 'shipped' | 'delivered' | 'ready_for_pickup';
  deliveryAddress: string;
  city: string;
  courier?: string;
  trackNumber?: string;
  estimatedDelivery: string;
  items: OrderItem[];
  totalAmount: number;
  currency: string;
}

export interface DeliveryCalculation {
  city: string;
  weightKg: number;
  isExpress: boolean;
  baseCost: number;
  expressCost: number;
  totalCost: number;
  currency: string;
  estimatedDays: string;
}

// In-memory catalog of products
export const PRODUCTS_DB: Product[] = [
  // --- Ноутбуки (Laptops) ---
  {
    sku: 'LAPTOP-AIR-M3',
    title: 'Ноутбук Apple MacBook Air 13" M3 16/512GB Space Gray',
    category: 'laptops',
    price: 149990,
    currency: 'RUB',
    inStock: true,
    stockCount: 5,
    warehouse: 'Склад Юг (Москва)',
    description: 'Ультрабук премиум-класса на чипе Apple M3. Идеальный баланс производительности, экрана Liquid Retina и автономности до 18 часов для разработчиков и дизайнеров.',
    specs: {
      screen: '13.6" Liquid Retina (2560x1664) IPS 500 нит',
      cpu: 'Apple M3 (8 ядер CPU / 10 ядер GPU, 16-ядерный Neural Engine)',
      ram: '16 GB Unified Memory',
      ssd: '512 GB PCIe NVMe',
      weight: '1.24 кг',
      battery: 'До 18 часов работы, MagSafe 3',
      color: 'Space Gray',
      os: 'macOS Sonoma',
    },
  },
  {
    sku: 'LAPTOP-AIR-M2',
    title: 'Ноутбук Apple MacBook Air 13" M2 8/256GB Midnight',
    category: 'laptops',
    price: 104990,
    currency: 'RUB',
    inStock: true,
    stockCount: 12,
    warehouse: 'Склад Север (Москва)',
    description: 'Легкий и энергоэффективный ноутбук Apple на чипе M2 для повседневной офисной работы, аналитики и работы в поездках.',
    specs: {
      screen: '13.6" Liquid Retina (2560x1664)',
      cpu: 'Apple M2 (8 CPU / 8 GPU)',
      ram: '8 GB Unified Memory',
      ssd: '256 GB',
      weight: '1.24 кг',
      battery: 'До 18 часов работы',
      color: 'Midnight Blue',
      os: 'macOS Sonoma',
    },
  },
  {
    sku: 'LAPTOP-THINKPAD-T14',
    title: 'Ноутбук Lenovo ThinkPad T14 Gen 4 Intel Core i7 32/1TB',
    category: 'laptops',
    price: 139990,
    currency: 'RUB',
    inStock: true,
    stockCount: 7,
    warehouse: 'Склад Восток (Санкт-Петербург)',
    description: 'Легендарный корпоративный рабочий ноутбук с военной защитой корпуса MIL-STD-810H, лучшей клавиатурой с манипулятором TrackPoint и 32 ГБ оперативной памяти.',
    specs: {
      screen: '14.0" WUXGA (1920x1200) IPS матовый, 400 нит',
      cpu: 'Intel Core i7-1365U (10 ядер, до 5.2 ГГц, vPro)',
      ram: '32 GB DDR5 5200 МГц',
      ssd: '1 TB M.2 PCIe 4.0 NVMe',
      weight: '1.36 кг',
      security: 'Сканер отпечатков пальцев, ИК-камера с защитной шторкой ThinkShutter, dTPM 2.0',
      battery: 'До 12 часов, быстрая зарядка 80% за 60 минут',
      color: 'Thunder Black',
      os: 'Windows 11 Pro',
    },
  },
  {
    sku: 'LAPTOP-ZENBOOK-14',
    title: 'Ультрабук ASUS ZenBook 14 OLED Intel Core Ultra 7 16/1TB',
    category: 'laptops',
    price: 124990,
    currency: 'RUB',
    inStock: true,
    stockCount: 9,
    warehouse: 'Склад Казань (Центр)',
    description: 'Сверхкомпактный премиальный ультрабук с 2.8K 120Hz OLED дисплеем и NPU-сопроцессором Intel AI Boost для локального запуска нейросетей.',
    specs: {
      screen: '14.0" 2.8K (2880x1800) OLED 120Hz 100% DCI-P3 DisplayHDR 600',
      cpu: 'Intel Core Ultra 7 155H (16 ядер / 22 потока, до 4.8 ГГц, Intel Arc Graphics)',
      ram: '16 GB LPDDR5X 7467 МГц',
      ssd: '1 TB M.2 NVMe PCIe 4.0',
      weight: '1.20 кг (толщина 14.9 мм)',
      battery: '75 Вт*ч (до 15 часов автономной работы)',
      color: 'Ponder Blue',
      os: 'Windows 11 Home',
    },
  },
  {
    sku: 'LAPTOP-XPS-13',
    title: 'Ультрабук Dell XPS 13 Plus 9320 Core i7 16/512GB Platinum',
    category: 'laptops',
    price: 147990,
    currency: 'RUB',
    inStock: true,
    stockCount: 3,
    warehouse: 'Склад Север (Москва)',
    description: 'Флагманский ультрабук бизнес-серии из фрезерованного алюминия и стекла с безрамочным экраном InfinityEdge и емкостной панелью функций.',
    specs: {
      screen: '13.4" 3.5K (3456x2160) OLED Touch Gorilla Glass 7',
      cpu: 'Intel Core i7-1360P (12 ядер, до 5.0 ГГц)',
      ram: '16 GB LPDDR5 6000 МГц',
      ssd: '512 GB PCIe 4.0 NVMe',
      weight: '1.23 кг',
      battery: '55 Вт*ч, поддержка ExpressCharge',
      color: 'Platinum Silver',
      os: 'Windows 11 Pro',
    },
  },
  {
    sku: 'LAPTOP-MATEBOOK-XPRO',
    title: 'Ноутбук HUAWEI MateBook X Pro Core i7 16/1TB Ink Blue',
    category: 'laptops',
    price: 144990,
    currency: 'RUB',
    inStock: true,
    stockCount: 6,
    warehouse: 'Склад Юг (Москва)',
    description: 'Элегантный тонкий ноутбук в софт-тач корпусе из магниевого сплава с 3.1K сенсорным дисплеем 90Hz и аудиосистемой из 6 динамиков.',
    specs: {
      screen: '14.2" 3.1K (3120x2080) LTPS 90Hz 500 нит сенсорный',
      cpu: 'Intel Core i7-1360P (12 ядер, до 5.0 ГГц)',
      ram: '16 GB LPDDR5',
      ssd: '1 TB NVMe SSD',
      weight: '1.26 кг',
      battery: '60 Вт*ч, адаптер питания 90W SuperCharge',
      color: 'Ink Blue (Магниевый сплав)',
      os: 'Windows 11 Home',
    },
  },
  {
    sku: 'LAPTOP-XIAOMI-PRO16',
    title: 'Ноутбук Xiaomi Book Pro 16 4K OLED Ryzen 7 16/512GB',
    category: 'laptops',
    price: 99990,
    currency: 'RUB',
    inStock: true,
    stockCount: 14,
    warehouse: 'Склад Казань (Центр)',
    description: 'Большой профессиональный дисплей 4K OLED с калибровкой Delta E < 0.33 и производительным процессором AMD Ryzen для работы с кодом и графикой.',
    specs: {
      screen: '16.0" 4K (3840x2400) OLED Super Retina Touch 600 нит',
      cpu: 'AMD Ryzen 7 6800H (8 ядер / 16 потоков, до 4.7 ГГц)',
      ram: '16 GB LPDDR5 6400 МГц',
      ssd: '512 GB PCIe 4.0',
      weight: '1.80 кг',
      battery: '70 Вт*ч, зарядка 100W GaN Type-C',
      color: 'Space Gray',
      os: 'Windows 11 Home',
    },
  },
  {
    sku: 'LAPTOP-SWIFT-GO',
    title: 'Ноутбук Acer Swift Go 14 OLED Core i5 16/512GB Silver',
    category: 'laptops',
    price: 79990,
    currency: 'RUB',
    inStock: true,
    stockCount: 18,
    warehouse: 'Склад Север (Москва)',
    description: 'Доступный и надежный рабочий ультрабук с ярким OLED экраном 90Hz и веб-камерой 1440p QHD с шумоподавлением для конференций.',
    specs: {
      screen: '14.0" 2.8K (2880x1800) OLED 90Hz 100% DCI-P3',
      cpu: 'Intel Core i5-13500H (12 ядер, до 4.7 ГГц)',
      ram: '16 GB LPDDR5',
      ssd: '512 GB M.2 NVMe',
      weight: '1.25 кг',
      battery: '65 Вт*ч (до 10 часов автономной работы)',
      color: 'Pure Silver',
      os: 'Без ОС (FreeDOS)',
    },
  },
  {
    sku: 'LAPTOP-HP-ELITE',
    title: 'Ноутбук HP EliteBook 840 G10 Core i7 16/512GB Silver',
    category: 'laptops',
    price: 134990,
    currency: 'RUB',
    inStock: true,
    stockCount: 8,
    warehouse: 'Склад Север (Москва)',
    description: 'Премиальный защищенный корпоративный ноутбук с комплексом безопасности HP Wolf Pro Security и чистым звуком Bang & Olufsen.',
    specs: {
      screen: '14.0" WUXGA (1920x1200) IPS антибликовый 400 нит',
      cpu: 'Intel Core i7-1355U (10 ядер, до 5.0 ГГц)',
      ram: '16 GB DDR5 5200 МГц (расширяемая до 64 ГБ)',
      ssd: '512 GB PCIe NVMe',
      weight: '1.36 кг',
      battery: '51 Вт*ч, HP Fast Charge 50% за 30 мин',
      color: 'Pike Silver',
      os: 'Windows 11 Pro',
    },
  },
  {
    sku: 'LAPTOP-PRO-16-M3MAX',
    title: 'Ноутбук Apple MacBook Pro 16" M3 Max 36/1TB Space Black',
    category: 'laptops',
    price: 349990,
    currency: 'RUB',
    inStock: true,
    stockCount: 2,
    warehouse: 'Склад Север (Москва)',
    description: 'Ультимативная рабочая станция для сложнейших задач ML/AI разработки, рендеринга и 3D-моделирования.',
    specs: {
      screen: '16.2" Liquid Retina XDR (3456x2234) ProMotion 120Hz 1600 нит',
      cpu: 'Apple M3 Max (14 CPU / 30 GPU)',
      ram: '36 GB Unified Memory (пропускная способность 300 ГБ/с)',
      ssd: '1 TB Apple NVMe',
      weight: '2.16 кг',
      battery: 'До 22 часов работы',
      color: 'Space Black',
      os: 'macOS Sonoma',
    },
  },

  // --- Смартфоны (Smartphones) ---
  {
    sku: 'PHONE-15-PRO',
    title: 'Смартфон Apple iPhone 15 Pro 256GB Titanium',
    category: 'smartphones',
    price: 119990,
    currency: 'RUB',
    inStock: true,
    stockCount: 14,
    warehouse: 'Склад Север (Москва)',
    description: 'Флагманский смартфон с титановым корпусом, процессором A17 Pro и камерой 48 Мп.',
    specs: {
      screen: '6.1" Super Retina XDR OLED 120Hz',
      cpu: 'Apple A17 Pro',
      memory: '256 GB',
      color: 'Natural Titanium',
    },
  },
  {
    sku: 'PHONE-15-BASE',
    title: 'Смартфон Apple iPhone 15 128GB Black',
    category: 'smartphones',
    price: 79990,
    currency: 'RUB',
    inStock: true,
    stockCount: 22,
    warehouse: 'Склад Юг (Москва)',
    description: 'Базовый флагман Apple с Dynamic Island, камерой 48 Мп и чипом A16 Bionic.',
    specs: {
      screen: '6.1" Super Retina XDR',
      cpu: 'Apple A16 Bionic',
      memory: '128 GB',
      color: 'Black',
    },
  },
  {
    sku: 'PHONE-S24-ULTRA',
    title: 'Смартфон Samsung Galaxy S24 Ultra 12/512GB Titanium Gray',
    category: 'smartphones',
    price: 129990,
    currency: 'RUB',
    inStock: true,
    stockCount: 9,
    warehouse: 'Склад Восток (Санкт-Петербург)',
    description: 'Флагман Samsung с титановой рамкой, искусственным интеллектом Galaxy AI и электронным пером S-Pen.',
    specs: {
      screen: '6.8" Dynamic AMOLED 2X 120Hz Gorilla Armor',
      cpu: 'Snapdragon 8 Gen 3 for Galaxy',
      memory: '12 GB RAM / 512 GB UFS 4.0',
      color: 'Titanium Gray',
    },
  },
  {
    sku: 'PHONE-PIXEL-8PRO',
    title: 'Смартфон Google Pixel 8 Pro 12/256GB Obsidian',
    category: 'smartphones',
    price: 89990,
    currency: 'RUB',
    inStock: true,
    stockCount: 11,
    warehouse: 'Склад Север (Москва)',
    description: 'Эталонный Android-смартфон с алгоритмами Google Tensor G3 и продвинутой камерой AI Computational Photography.',
    specs: {
      screen: '6.7" Super Actua OLED 1-120Hz',
      cpu: 'Google Tensor G3, Titan M2',
      memory: '12 GB / 256 GB',
      color: 'Obsidian',
    },
  },

  // --- Аудио (Audio) ---
  {
    sku: 'HEADPHONES-MAX',
    title: 'Беспроводные наушники Apple AirPods Max Silver',
    category: 'audio',
    price: 64990,
    currency: 'RUB',
    inStock: true,
    stockCount: 8,
    warehouse: 'Склад Север (Москва)',
    description: 'Полноразмерные беспроводные наушники с активным шумоподавлением и пространственным звуком.',
    specs: {
      type: 'Over-ear',
      anc: 'Active Noise Cancellation + Transparency',
      battery: 'До 20 часов воспроизведения',
      connection: 'Bluetooth 5.0, Apple H1 chip',
    },
  },
  {
    sku: 'HEADPHONES-PRO2',
    title: 'Беспроводные наушники Apple AirPods Pro 2 USB-C',
    category: 'audio',
    price: 23990,
    currency: 'RUB',
    inStock: true,
    stockCount: 35,
    warehouse: 'Склад Юг (Москва)',
    description: 'Внутриканальные наушники с чипом H2, адаптивным звуком и кейсом с портом USB-C.',
    specs: {
      type: 'In-ear TWS',
      anc: 'Active Noise Cancellation 2x',
      battery: 'До 30 часов с кейсом',
      connector: 'USB-C MagSafe Case',
    },
  },
  {
    sku: 'HEADPHONES-SONY-XM5',
    title: 'Беспроводные наушники Sony WH-1000XM5 Black',
    category: 'audio',
    price: 34990,
    currency: 'RUB',
    inStock: true,
    stockCount: 15,
    warehouse: 'Склад Казань (Центр)',
    description: 'Премиальные наушники с лучшим на рынке активным шумоподавлением на базе процессора V1 и HD-кодеком LDAC.',
    specs: {
      type: 'Over-ear',
      anc: 'Dual Noise Sensor, QN1 + V1 processors',
      battery: 'До 30 часов с ANC',
      codecs: 'LDAC, AAC, SBC',
    },
  },

  // --- Носимые устройства (Wearables) ---
  {
    sku: 'WATCH-ULTRA-2',
    title: 'Смарт-часы Apple Watch Ultra 2 49mm Titanium',
    category: 'wearables',
    price: 89990,
    currency: 'RUB',
    inStock: false,
    stockCount: 0,
    warehouse: 'Центральный склад (Ожидается поставка)',
    description: 'Защищенные смарт-часы для экстремальных нагрузок с сапфировым стеклом и GPS L1/L5.',
    specs: {
      case: '49mm Titanium',
      brightness: 'До 3000 нит',
      waterproof: 'Погружение до 100 метров (WR100)',
      battery: 'До 36 часов работы',
    },
  },
  {
    sku: 'WATCH-SERIES-9',
    title: 'Смарт-часы Apple Watch Series 9 45mm Midnight',
    category: 'wearables',
    price: 42990,
    currency: 'RUB',
    inStock: true,
    stockCount: 18,
    warehouse: 'Склад Север (Москва)',
    description: 'Умные часы с новым процессором S9, жестом Double Tap и сверхъярким экраном 2000 нит.',
    specs: {
      case: '45mm Алюминий',
      display: 'Always-On Retina OLED 2000 нит',
      battery: 'До 18 часов (до 36 часов в режиме энергосбережения)',
    },
  },

  // --- Аксессуары (Accessories) ---
  {
    sku: 'CASE-MAGSAFE',
    title: 'Чехол Silicone Case with MagSafe для iPhone 15 Pro',
    category: 'accessories',
    price: 4990,
    currency: 'RUB',
    inStock: true,
    stockCount: 32,
    warehouse: 'Склад Восток (Санкт-Петербург)',
    description: 'Силиконовый чехол с поддержкой беспроводной магнитной зарядки MagSafe.',
    specs: {
      material: 'Soft-touch силикон с микрофиброй',
      magsafe: 'Встроенные магниты',
      color: 'Midnight Blue',
    },
  },
  {
    sku: 'CHARGER-DUAL-35W',
    title: 'Адаптер питания Apple 35W Dual USB-C Power Adapter',
    category: 'accessories',
    price: 5490,
    currency: 'RUB',
    inStock: true,
    stockCount: 40,
    warehouse: 'Склад Север (Москва)',
    description: 'Компактное зарядное устройство с двумя портами USB-C для одновременной зарядки ноутбука и смартфона.',
    specs: {
      power: '35W Dual USB-C',
      compatibility: 'MacBook Air, iPhone, iPad, Apple Watch',
    },
  },
  {
    sku: 'HUB-TYPE-C-8IN1',
    title: 'USB-C хаб Satechi Multi-Port Adapter 8-in-1 Space Gray',
    category: 'accessories',
    price: 8990,
    currency: 'RUB',
    inStock: true,
    stockCount: 25,
    warehouse: 'Склад Казань (Центр)',
    description: 'Алюминиевый хаб с поддержкой 4K 60Hz HDMI, Gigabit Ethernet, кардридера SD/microSD и сквозной зарядки 100W PD.',
    specs: {
      ports: '4K HDMI, Gigabit LAN, 3x USB-A 3.0, SD/MicroSD, USB-C 100W PD',
      material: 'Алюминиевый сплав',
      color: 'Space Gray',
    },
  },
];

// In-memory orders database
export const ORDERS_DB: Order[] = [
  {
    orderId: 'ORD-7741',
    clientName: 'Алексей Смирнов',
    clientPhone: '+7 (999) 123-45-67',
    status: 'shipped',
    deliveryAddress: 'г. Москва, ул. Тверская, д. 12, кв. 34',
    city: 'Москва',
    courier: 'CDEK Express',
    trackNumber: 'CDK-982341234',
    estimatedDelivery: '2026-10-01 (Завтра с 10:00 до 18:00)',
    items: [
      {
        sku: 'PHONE-15-PRO',
        title: 'Смартфон Apple iPhone 15 Pro 256GB Titanium',
        quantity: 1,
        price: 119990,
      },
      {
        sku: 'CASE-MAGSAFE',
        title: 'Чехол Silicone Case with MagSafe',
        quantity: 1,
        price: 4990,
      },
    ],
    totalAmount: 124980,
    currency: 'RUB',
  },
  {
    orderId: 'ORD-8820',
    clientName: 'Мария Васильева',
    clientPhone: '+7 (911) 234-56-78',
    status: 'ready_for_pickup',
    deliveryAddress: 'Пункт выдачи Boxberry: г. Санкт-Петербург, Невский пр-т, д. 45',
    city: 'Санкт-Петербург',
    courier: 'Boxberry Pickup',
    trackNumber: 'BXB-7721830',
    estimatedDelivery: 'Доступен к получению до 2026-10-07',
    items: [
      {
        sku: 'HEADPHONES-MAX',
        title: 'Беспроводные наушники Apple AirPods Max Silver',
        quantity: 1,
        price: 64990,
      },
    ],
    totalAmount: 64990,
    currency: 'RUB',
  },
  {
    orderId: 'ORD-9905',
    clientName: 'Дмитрий Кузнецов',
    clientPhone: '+7 (987) 345-67-89',
    status: 'processing',
    deliveryAddress: 'г. Казань, ул. Баумана, д. 28, оф. 4',
    city: 'Казань',
    courier: 'Деловые Линии',
    trackNumber: 'В формировании',
    estimatedDelivery: '2026-10-04',
    items: [
      {
        sku: 'LAPTOP-AIR-M3',
        title: 'Ноутбук Apple MacBook Air 13" M3 16/512GB',
        quantity: 1,
        price: 149990,
      },
    ],
    totalAmount: 149990,
    currency: 'RUB',
  },
];

// Delivery rates by city
const DELIVERY_RATES: Record<string, { base: number; perKg: number; days: string }> = {
  москва: { base: 350, perKg: 50, days: '1-2 рабочих дня' },
  'санкт-петербург': { base: 450, perKg: 60, days: '2-3 рабочих дня' },
  казань: { base: 550, perKg: 70, days: '2-4 рабочих дня' },
  екатеринбург: { base: 650, perKg: 80, days: '3-5 рабочих дней' },
  новосибирск: { base: 800, perKg: 90, days: '4-6 рабочих дней' },
  владивосток: { base: 1200, perKg: 150, days: '6-9 рабочих дней' },
};

export const MockEcommerceService = {
  /**
   * Search catalog products by text query, category or max price
   */
  searchProducts(query?: string, category?: string, maxPrice?: number) {
    let results = [...PRODUCTS_DB];

    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      results = results.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      );
    }

    if (category && category.trim()) {
      const c = category.toLowerCase().trim();
      results = results.filter((p) => p.category.toLowerCase() === c);
    }

    if (typeof maxPrice === 'number' && maxPrice > 0) {
      results = results.filter((p) => p.price <= maxPrice);
    }

    return {
      totalFound: results.length,
      products: results.map((p) => ({
        sku: p.sku,
        title: p.title,
        category: p.category,
        price: p.price,
        currency: p.currency,
        inStock: p.inStock,
        stockCount: p.stockCount,
        warehouse: p.warehouse,
        description: p.description,
        specs: p.specs,
      })),
    };
  },

  /**
   * Get detailed product info by SKU
   */
  getProductBySku(sku: string) {
    if (!sku || !sku.trim()) {
      throw new Error('Параметр sku обязателен для поиска товара');
    }
    const cleanSku = sku.toUpperCase().trim();
    const product = PRODUCTS_DB.find((p) => p.sku.toUpperCase() === cleanSku);

    if (!product) {
      return {
        found: false,
        message: `Товар с артикулом "${sku}" не найден в каталоге магазина.`,
        availableSkus: PRODUCTS_DB.map((p) => p.sku),
      };
    }

    return {
      found: true,
      product,
    };
  },

  /**
   * Get order details and tracking status by order ID
   */
  getOrderStatus(orderId: string) {
    if (!orderId || !orderId.trim()) {
      throw new Error('Параметр order_id обязателен для получения статуса');
    }
    const cleanId = orderId.toUpperCase().trim();
    const order = ORDERS_DB.find((o) => o.orderId.toUpperCase() === cleanId);

    if (!order) {
      return {
        found: false,
        message: `Заказ "${orderId}" не найден в базе данных.`,
        sampleOrderIds: ORDERS_DB.map((o) => o.orderId),
      };
    }

    return {
      found: true,
      order,
    };
  },

  /**
   * Calculate delivery cost and terms
   */
  calculateDelivery(city: string, weightKg: number, express = false): DeliveryCalculation {
    if (!city || !city.trim()) {
      throw new Error('Параметр city обязателен для расчета доставки');
    }
    const safeWeight = Math.max(0.1, Number(weightKg) || 1.0);
    const normalizedCity = city.toLowerCase().trim();

    const rate = DELIVERY_RATES[normalizedCity] || {
      base: 700,
      perKg: 85,
      days: '3-6 рабочих дней',
    };

    const baseCost = Math.round(rate.base + safeWeight * rate.perKg);
    const expressCost = express ? Math.round(baseCost * 0.6) : 0;
    const totalCost = baseCost + expressCost;

    const days = express ? 'Срочная доставка (1-2 дня)' : rate.days;

    return {
      city: city.trim(),
      weightKg: safeWeight,
      isExpress: express,
      baseCost,
      expressCost,
      totalCost,
      currency: 'RUB',
      estimatedDays: days,
    };
  },
};
