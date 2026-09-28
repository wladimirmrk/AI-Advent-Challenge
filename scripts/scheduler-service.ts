import fs from 'node:fs';
import path from 'node:path';
import { PRODUCTS_DB, ORDERS_DB, Product, Order } from './mock-store.js';

export type MonitorTarget = 'products' | 'orders' | 'all';

export interface ScheduledTask {
  id: string;
  target: MonitorTarget;
  intervalSeconds: number;
  delaySeconds?: number;
  notes?: string;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt: number;
  runCount: number;
  status: 'active' | 'completed' | 'paused';
  isOneOff: boolean;
}

export interface ProductSnapshotItem {
  sku: string;
  title: string;
  price: number;
  stockCount: number;
  inStock: boolean;
}

export interface OrderSnapshotItem {
  orderId: string;
  clientName: string;
  status: 'processing' | 'shipped' | 'delivered' | 'ready_for_pickup';
  totalAmount: number;
}

export interface MonitoringSnapshot {
  id: string;
  taskId: string;
  timestamp: number;
  isoTime: string;
  products?: ProductSnapshotItem[];
  orders?: OrderSnapshotItem[];
}

export interface PriceDelta {
  sku: string;
  title: string;
  oldPrice: number;
  newPrice: number;
  delta: number;
  percentChange: number;
}

export interface StockAlert {
  sku: string;
  title: string;
  stockCount: number;
  severity: 'out_of_stock' | 'low_stock';
}

export interface OrderStatusChange {
  orderId: string;
  clientName: string;
  oldStatus: string;
  newStatus: string;
}

export interface AggregatedSummary {
  status: 'success' | 'empty';
  target: MonitorTarget;
  activeTasksCount: number;
  totalCycles: number;
  monitoringSince?: string;
  lastUpdated?: string;
  priceChanges: PriceDelta[];
  stockAlerts: {
    outOfStock: StockAlert[];
    lowStock: StockAlert[];
  };
  ordersSummary: {
    totalOrders: number;
    byStatus: Record<string, number>;
    statusChanges: OrderStatusChange[];
  };
  alerts: Array<{
    level: 'CRITICAL' | 'WARNING' | 'INFO';
    message: string;
    timestamp: string;
  }>;
  executiveSummary: string;
}

export interface SchedulerPersistedData {
  version: string;
  updatedAt: number;
  tasks: ScheduledTask[];
  snapshots: MonitoringSnapshot[];
}

export class SchedulerService {
  private static instance: SchedulerService;
  private storagePath: string;
  private tasks: Map<string, ScheduledTask> = new Map();
  private snapshots: MonitoringSnapshot[] = [];
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private maxSnapshots = 200;
  private isRunning = false;

  constructor(customStoragePath?: string) {
    this.storagePath =
      customStoragePath ||
      path.join(process.cwd(), 'data', 'scheduler-data.json');
    this.loadFromFile();
  }

  public static getInstance(customStoragePath?: string): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService(customStoragePath);
    }
    return SchedulerService.instance;
  }

  public setStoragePath(newPath: string) {
    this.storagePath = newPath;
    this.loadFromFile();
  }

  /**
   * Schedule a new periodic or delayed monitoring task
   */
  public scheduleTask(params: {
    target: MonitorTarget;
    intervalSeconds: number;
    delaySeconds?: number;
    notes?: string;
  }): ScheduledTask {
    const now = Date.now();
    const interval = Math.max(1, Number(params.intervalSeconds) || 60);
    const delay = Math.max(0, Number(params.delaySeconds) || 0);
    const isOneOff = !params.intervalSeconds && delay > 0;

    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nextRunAt = now + (delay > 0 ? delay * 1000 : interval * 1000);

    const task: ScheduledTask = {
      id,
      target: params.target || 'all',
      intervalSeconds: interval,
      delaySeconds: delay > 0 ? delay : undefined,
      notes: params.notes || `Scheduled ${params.target} monitor every ${interval}s`,
      createdAt: now,
      nextRunAt,
      runCount: 0,
      status: 'active',
      isOneOff,
    };

    this.tasks.set(id, task);

    // If delay is 0, run an immediate initial cycle
    if (delay === 0) {
      this.runTaskCycle(id);
    }

    // Arm timer
    this.armTaskTimer(task);
    this.saveToFile();

    return task;
  }

  /**
   * Arm a timer for a specific task
   */
  private armTaskTimer(task: ScheduledTask) {
    // Clear any existing timer
    if (this.timers.has(task.id)) {
      clearTimeout(this.timers.get(task.id)!);
      this.timers.delete(task.id);
    }

    if (task.status !== 'active') return;

    const now = Date.now();
    const delayMs = Math.max(50, task.nextRunAt - now);

    const timer = setTimeout(() => {
      this.runTaskCycle(task.id);

      // Re-fetch in case status changed
      const currentTask = this.tasks.get(task.id);
      if (!currentTask || currentTask.status !== 'active') return;

      if (currentTask.isOneOff) {
        currentTask.status = 'completed';
        this.saveToFile();
        return;
      }

      // Schedule next recurring run
      currentTask.nextRunAt = Date.now() + currentTask.intervalSeconds * 1000;
      this.saveToFile();
      this.armTaskTimer(currentTask);
    }, delayMs);

    // Do not hold process alive if running in background
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    this.timers.set(task.id, timer);
  }

  /**
   * Execute one monitoring cycle for a given task
   */
  public runTaskCycle(taskId: string): MonitoringSnapshot | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const now = Date.now();
    const snapshotId = `snap_${now}_${Math.random().toString(36).substring(2, 6)}`;

    let productsSnapshot: ProductSnapshotItem[] | undefined;
    let ordersSnapshot: OrderSnapshotItem[] | undefined;

    if (task.target === 'products' || task.target === 'all') {
      productsSnapshot = PRODUCTS_DB.map((p) => ({
        sku: p.sku,
        title: p.title,
        price: p.price,
        stockCount: p.stockCount,
        inStock: p.inStock,
      }));
    }

    if (task.target === 'orders' || task.target === 'all') {
      ordersSnapshot = ORDERS_DB.map((o) => ({
        orderId: o.orderId,
        clientName: o.clientName,
        status: o.status,
        totalAmount: o.totalAmount,
      }));
    }

    const snapshot: MonitoringSnapshot = {
      id: snapshotId,
      taskId: task.id,
      timestamp: now,
      isoTime: new Date(now).toISOString(),
      products: productsSnapshot,
      orders: ordersSnapshot,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }

    task.runCount += 1;
    task.lastRunAt = now;
    this.saveToFile();

    return snapshot;
  }

  /**
   * Helper to simulate market changes (for testing deltas and alerts)
   */
  public simulateProductChange(sku: string, newPrice?: number, newStock?: number) {
    const product = PRODUCTS_DB.find((p) => p.sku === sku);
    if (!product) return false;
    if (typeof newPrice === 'number') product.price = newPrice;
    if (typeof newStock === 'number') {
      product.stockCount = newStock;
      product.inStock = newStock > 0;
    }
    return true;
  }

  public simulateOrderStatusChange(
    orderId: string,
    newStatus: 'processing' | 'shipped' | 'delivered' | 'ready_for_pickup'
  ) {
    const order = ORDERS_DB.find((o) => o.orderId === orderId);
    if (!order) return false;
    order.status = newStatus;
    return true;
  }

  /**
   * List all scheduled tasks
   */
  public getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get all collected snapshots
   */
  public getSnapshots(): MonitoringSnapshot[] {
    return this.snapshots;
  }

  /**
   * Compute aggregated summary across collected snapshots
   */
  public getAggregatedSummary(target: MonitorTarget = 'all'): AggregatedSummary {
    const activeTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'active'
    );

    if (this.snapshots.length === 0) {
      return {
        status: 'empty',
        target,
        activeTasksCount: activeTasks.length,
        totalCycles: 0,
        priceChanges: [],
        stockAlerts: { outOfStock: [], lowStock: [] },
        ordersSummary: { totalOrders: 0, byStatus: {}, statusChanges: [] },
        alerts: [
          {
            level: 'INFO',
            message: 'Нет собранных данных мониторинга. Запустите schedule_monitor для начала сбора.',
            timestamp: new Date().toISOString(),
          },
        ],
        executiveSummary: 'Мониторинг не запущен или еще не собрал ни одного снапшота.',
      };
    }

    // Snapshots that contain target data
    const relevantSnapshots = this.snapshots.filter((s) => {
      if (target === 'products') return !!s.products;
      if (target === 'orders') return !!s.orders;
      return !!s.products || !!s.orders;
    });

    const firstSnap = relevantSnapshots[0] || this.snapshots[0];
    const latestSnap =
      relevantSnapshots[relevantSnapshots.length - 1] ||
      this.snapshots[this.snapshots.length - 1];

    const alerts: Array<{
      level: 'CRITICAL' | 'WARNING' | 'INFO';
      message: string;
      timestamp: string;
    }> = [];

    // 1. Price Changes Detection
    const priceChanges: PriceDelta[] = [];
    if (firstSnap?.products && latestSnap?.products) {
      const firstMap = new Map(firstSnap.products.map((p) => [p.sku, p]));
      for (const curr of latestSnap.products) {
        const initial = firstMap.get(curr.sku);
        if (initial && initial.price !== curr.price) {
          const delta = curr.price - initial.price;
          const percent = Number(((delta / initial.price) * 100).toFixed(2));
          priceChanges.push({
            sku: curr.sku,
            title: curr.title,
            oldPrice: initial.price,
            newPrice: curr.price,
            delta,
            percentChange: percent,
          });

          if (delta > 0) {
            alerts.push({
              level: 'INFO',
              message: `Повышение цены на ${curr.title} (SKU: ${curr.sku}): с ${initial.price} до ${curr.price} RUB (+${percent}%)`,
              timestamp: latestSnap.isoTime,
            });
          } else {
            alerts.push({
              level: 'INFO',
              message: `Снижение цены (скидка) на ${curr.title} (SKU: ${curr.sku}): с ${initial.price} до ${curr.price} RUB (${percent}%)`,
              timestamp: latestSnap.isoTime,
            });
          }
        }
      }
    }

    // 2. Stock Alerts
    const outOfStock: StockAlert[] = [];
    const lowStock: StockAlert[] = [];
    if (latestSnap?.products) {
      for (const p of latestSnap.products) {
        if (p.stockCount === 0 || !p.inStock) {
          outOfStock.push({
            sku: p.sku,
            title: p.title,
            stockCount: p.stockCount,
            severity: 'out_of_stock',
          });
          alerts.push({
            level: 'CRITICAL',
            message: `Товар закончился на складе: ${p.title} (SKU: ${p.sku})`,
            timestamp: latestSnap.isoTime,
          });
        } else if (p.stockCount <= 3) {
          lowStock.push({
            sku: p.sku,
            title: p.title,
            stockCount: p.stockCount,
            severity: 'low_stock',
          });
          alerts.push({
            level: 'WARNING',
            message: `Заканчивается на складе (осталось ${p.stockCount} шт.): ${p.title} (SKU: ${p.sku})`,
            timestamp: latestSnap.isoTime,
          });
        }
      }
    }

    // 3. Orders Analysis & Status Changes
    const byStatus: Record<string, number> = {};
    const statusChanges: OrderStatusChange[] = [];
    let totalOrders = 0;

    if (latestSnap?.orders) {
      totalOrders = latestSnap.orders.length;
      for (const o of latestSnap.orders) {
        byStatus[o.status] = (byStatus[o.status] || 0) + 1;
      }

      if (firstSnap?.orders) {
        const firstOrderMap = new Map(firstSnap.orders.map((o) => [o.orderId, o]));
        for (const curr of latestSnap.orders) {
          const initial = firstOrderMap.get(curr.orderId);
          if (initial && initial.status !== curr.status) {
            statusChanges.push({
              orderId: curr.orderId,
              clientName: curr.clientName,
              oldStatus: initial.status,
              newStatus: curr.status,
            });
            alerts.push({
              level: 'INFO',
              message: `Заказ ${curr.orderId} (${curr.clientName}) изменил статус: ${initial.status} ➔ ${curr.status}`,
              timestamp: latestSnap.isoTime,
            });
          }
        }
      }
    }

    // Executive summary synthesis
    const parts: string[] = [
      `Собрано ${relevantSnapshots.length} циклов мониторинга с ${firstSnap.isoTime} по ${latestSnap.isoTime}.`,
    ];
    if (priceChanges.length > 0) {
      parts.push(`Зафиксировано изменений цен: ${priceChanges.length}.`);
    } else {
      parts.push(`Цены стабильны.`);
    }
    if (outOfStock.length > 0 || lowStock.length > 0) {
      parts.push(
        `Складские предупреждения: ${outOfStock.length} отсутствуют, ${lowStock.length} на исходе.`
      );
    } else {
      parts.push(`Складские запасы в норме.`);
    }
    if (statusChanges.length > 0) {
      parts.push(`Обновлено статусов заказов: ${statusChanges.length}.`);
    }

    return {
      status: 'success',
      target,
      activeTasksCount: activeTasks.length,
      totalCycles: relevantSnapshots.length,
      monitoringSince: firstSnap.isoTime,
      lastUpdated: latestSnap.isoTime,
      priceChanges,
      stockAlerts: { outOfStock, lowStock },
      ordersSummary: { totalOrders, byStatus, statusChanges },
      alerts,
      executiveSummary: parts.join(' '),
    };
  }

  /**
   * Save all tasks and snapshots to JSON file on disk
   */
  public saveToFile() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: SchedulerPersistedData = {
        version: '1.0.0',
        updatedAt: Date.now(),
        tasks: Array.from(this.tasks.values()),
        snapshots: this.snapshots,
      };

      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      console.error(`[SchedulerService] Error saving to ${this.storagePath}:`, err.message);
    }
  }

  /**
   * Load tasks and snapshots from JSON file
   */
  public loadFromFile() {
    try {
      if (!fs.existsSync(this.storagePath)) {
        return;
      }
      const raw = fs.readFileSync(this.storagePath, 'utf-8');
      const data: SchedulerPersistedData = JSON.parse(raw);
      if (Array.isArray(data.tasks)) {
        this.tasks.clear();
        for (const task of data.tasks) {
          this.tasks.set(task.id, task);
        }
      }
      if (Array.isArray(data.snapshots)) {
        this.snapshots = data.snapshots;
      }
    } catch (err: any) {
      console.warn(`[SchedulerService] Could not read ${this.storagePath}:`, err.message);
    }
  }

  /**
   * Start 24/7 background scheduler loop
   */
  public start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Rearm all active tasks
    for (const task of this.tasks.values()) {
      if (task.status === 'active') {
        this.armTaskTimer(task);
      }
    }
  }

  /**
   * Stop all active timers
   */
  public stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.isRunning = false;
    this.saveToFile();
  }

  /**
   * Clear all tasks and snapshots (useful for tests and resets)
   */
  public clearAll() {
    this.stop();
    this.tasks.clear();
    this.snapshots = [];
    if (fs.existsSync(this.storagePath)) {
      try {
        fs.unlinkSync(this.storagePath);
      } catch {}
    }
  }
}
