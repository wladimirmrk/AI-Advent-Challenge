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
    sku: 'LAPTOP-AIR-M3',
    title: 'Ноутбук Apple MacBook Air 13" M3 16/512GB',
    category: 'laptops',
    price: 149990,
    currency: 'RUB',
    inStock: true,
    stockCount: 5,
    warehouse: 'Склад Юг (Москва)',
    description: 'Тонкий и легкий ультрабук на чипе M3 с увеличенным объемом оперативной памяти.',
    specs: {
      screen: '13.6" Liquid Retina',
      cpu: 'Apple M3 (8 CPU / 10 GPU)',
      ram: '16 GB Unified Memory',
      ssd: '512 GB',
      color: 'Space Gray',
    },
  },
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
