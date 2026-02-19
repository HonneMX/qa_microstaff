import { useState, useCallback } from "react";

const API = "/api";

type CartItem = { id: string; name: string; priceCents: number; quantity: number };

const CATALOG: CartItem[] = [
  { id: "1", name: "Футболка свободный стиль", priceCents: 1999, quantity: 1 },
  { id: "2", name: "Гольфы Синема, 10 пар", priceCents: 3500, quantity: 1 },
  { id: "3", name: "Носки универсальные", priceCents: 899, quantity: 1 },
  { id: "4", name: "Толстовка с капюшоном", priceCents: 4490, quantity: 1 },
  { id: "5", name: "Брюки базовые", priceCents: 2990, quantity: 1 },
];

type Notification = {
  type: "paid" | "payment_failed";
  orderId: string;
  traceId: string;
  detail?: string;
};

export default function App() {
  const [view, setView] = useState<"catalog" | "cart">("catalog");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [testError, setTestError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<Notification | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string>("");
  const [lastOrderId, setLastOrderId] = useState<string>("");
  const [lastOtelTraceId, setLastOtelTraceId] = useState<string>("");
  const [grafanaIdsOpen, setGrafanaIdsOpen] = useState(false);

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  const updateQuantity = useCallback((id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const totalCents = cart.reduce((s, i) => s + i.priceCents * i.quantity, 0);

  const submitOrder = useCallback(async () => {
    if (cart.length === 0) return;
    setLoading(true);
    setNotification(null);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (testError) headers["X-Test-Error"] = testError;
    try {
      const res = await fetch(`${API}/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: cart.map(({ id, name, priceCents, quantity }) => ({ id, name, priceCents, quantity })),
          totalAmountCents: totalCents,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const traceId = res.headers.get("X-Trace-Id") || data.traceId || "";
      const orderId = data.orderId || "";
      setLastTraceId(traceId);
      setLastOrderId(orderId);
      setLastOtelTraceId(data.otelTraceId || "");

      if (!res.ok) {
        setNotification({
          type: "payment_failed",
          orderId: orderId || "—",
          traceId,
          detail: data.error || `HTTP ${res.status}`,
        });
        setLoading(false);
        return;
      }

      const es = new EventSource(`${API}/orders/${orderId}/events`);
      es.onmessage = (e) => {
        const payload = JSON.parse(e.data);
        if (payload.status === "paid" || payload.status === "payment_failed") {
          setNotification({
            type: payload.status,
            orderId: payload.orderId,
            traceId,
            detail: payload.detail,
          });
          es.close();
        }
      };
      es.onerror = () => {
        es.close();
        setNotification({
          type: "payment_failed",
          orderId,
          traceId,
          detail: "Соединение с сервером прервано",
        });
      };
      setLoading(false);
    } catch (err) {
      setNotification({
        type: "payment_failed",
        orderId: "",
        traceId: "",
        detail: (err as Error).message,
      });
      setLoading(false);
    }
  }, [cart, totalCents, testError]);

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  return (
    <>
      <header className="app-header">
        <a href="#" className="app-logo" onClick={(e) => { e.preventDefault(); setView("catalog"); }}>
          Маркетплейс
        </a>
        <input type="text" className="app-search" placeholder="Искать товары..." readOnly />
        <nav className="app-nav">
          <button
            type="button"
            className="app-nav-cart"
            onClick={() => setView("cart")}
            aria-label="Корзина"
          >
            Корзина
            {cartCount > 0 && <span className="count">{cartCount}</span>}
          </button>
        </nav>
      </header>

      {notification && (
        <div className={`notification ${notification.type === "paid" ? "success" : "error"}`}>
          <div>
            <p className="notification-detail">
              {notification.type === "paid"
                ? "Товары приобретены."
                : notification.detail || "Оплата не прошла."}
            </p>
          </div>
        </div>
      )}

      <main className="app-main">
        {view === "catalog" && (
          <>
            <aside className="catalog-sidebar">
              <h3>Категория</h3>
              <ul>
                <li>Товары</li>
              </ul>
            </aside>
            <div className="catalog-grid">
              {CATALOG.map((item) => (
                <article key={item.id} className="product-card">
                  <div className="product-card-image">📦</div>
                  <div className="product-card-body">
                    <h3 className="product-card-title">{item.name}</h3>
                    <span className="product-card-price">{(item.priceCents / 100).toFixed(0)} ₽</span>
                    <button
                      type="button"
                      className="product-card-add"
                      onClick={() => addToCart({ ...item })}
                    >
                      В корзину
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {view === "cart" && (
          <div className="cart-layout">
            <div className="cart-list">
              <h2>Корзина</h2>
              {cart.length === 0 ? (
                <div className="cart-empty">
                  <p>В корзине пока ничего нет</p>
                  <button type="button" className="back-catalog" onClick={() => setView("catalog")}>
                    Перейти в каталог
                  </button>
                </div>
              ) : (
                <>
                  {cart.map((i) => (
                    <div key={i.id} className="cart-item">
                      <div className="cart-item-image" />
                      <div className="cart-item-info">
                        <div className="cart-item-title">{i.name}</div>
                        <div className="cart-item-price">
                          {((i.priceCents * i.quantity) / 100).toFixed(0)} ₽
                        </div>
                      </div>
                      <div className="cart-item-actions">
                        <div className="cart-item-qty">
                          <button type="button" onClick={() => updateQuantity(i.id, -1)}>−</button>
                          <span>{i.quantity}</span>
                          <button type="button" onClick={() => updateQuantity(i.id, 1)}>+</button>
                        </div>
                        <button
                          type="button"
                          className="cart-item-remove"
                          onClick={() => removeFromCart(i.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            {cart.length > 0 && (
              <aside className="cart-sidebar">
                <h3>Ваша корзина</h3>
                <div className="cart-sidebar-total">
                  {cart.length} {cart.length === 1 ? "товар" : "товара"} · {(totalCents / 100).toFixed(0)} ₽
                </div>
                <button
                  type="button"
                  className="cart-sidebar-checkout"
                  onClick={submitOrder}
                  disabled={loading}
                >
                  {loading ? "Оформляем…" : "Купить"}
                </button>
                <p style={{ fontSize: "0.8rem", color: "#64748b", margin: "0 0 0.75rem" }}>
                  Доступные способы доставки можно выбрать при оформлении.
                </p>
                <div className="cart-sidebar-test">
                  <label>Учебный сценарий (для тестировщиков)</label>
                  <select
                    value={testError}
                    onChange={(e) => setTestError(e.target.value)}
                  >
                    <option value="">— нет —</option>
                    <option value="order_processing_failure">Ошибка обработки заказа</option>
                    <option value="bank_timeout">Таймаут банка</option>
                    <option value="payment_declined">Отказ в оплате</option>
                    <option value="payment_service_unavailable">Сервис оплаты недоступен</option>
                  </select>
                </div>
              </aside>
            )}
          </div>
        )}
      </main>

      <section className={`grafana-ids-block ${grafanaIdsOpen ? "open" : ""}`}>
        <button
          type="button"
          className="grafana-ids-toggle"
          onClick={() => setGrafanaIdsOpen((v) => !v)}
          aria-expanded={grafanaIdsOpen}
        >
          <span>Идентификаторы для поиска в Grafana (для проверки)</span>
          <span className="arrow">▼</span>
        </button>
        <div className="grafana-ids-content">
          <div className="grafana-ids-inner">
            {lastOrderId && (
              <p>
                <strong>Order ID:</strong> <code>{lastOrderId}</code>
                <span className="grafana-ids-hint"> — для pgAdmin и очередей</span>
              </p>
            )}
            {lastTraceId && (
              <p>
                <strong>Trace ID (для Loki, логи):</strong> <code>{lastTraceId}</code>
                <span className="grafana-ids-hint"> — в Grafana → Loki введите в запрос: traceId=&quot;{lastTraceId}&quot;</span>
              </p>
            )}
            {lastOtelTraceId && (
              <p>
                <strong>Trace ID для Tempo:</strong> <code>{lastOtelTraceId}</code>
                <span className="grafana-ids-hint"> — Grafana → Tempo → вкладка <strong>TraceQL</strong> → вставьте этот ID в поле запроса <strong>без кавычек</strong> → Run query</span>
              </p>
            )}
            {!lastTraceId && !lastOrderId && !lastOtelTraceId && (
              <p style={{ color: "#64748b" }}>После оформления заказа здесь появятся идентификаторы для проверки в Grafana.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
