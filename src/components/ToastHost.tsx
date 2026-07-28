import { dismissToast, useToasts, type ToastItem } from "@/lib/toast";

/** 右下角 Toast 宿主；由 showToast / updateToast 驱动。 */
export function ToastHost() {
  const items = useToasts();
  if (!items.length) return null;

  return (
    <div className="toast-wrap" aria-live="polite" aria-relevant="additions text">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismissible = item.dismissible !== false;
  const variant = item.variant ?? "info";

  return (
    <div className={`toast toast-${variant}`} role="status">
      <div className="toast-header">
        <div className="toast-title">{item.title}</div>
        {dismissible ? (
          <button
            type="button"
            className="toast-close"
            aria-label="Close"
            onClick={() => dismissToast(item.id)}
          >
            ×
          </button>
        ) : null}
      </div>
      {item.body ? <p className="toast-body">{item.body}</p> : null}
      {item.progress !== undefined ? (
        <div className="toast-progress" aria-hidden>
          <div
            className="toast-progress-bar"
            style={{
              width: item.progress == null ? "30%" : `${item.progress}%`,
              opacity: item.progress == null ? 0.55 : 1,
            }}
          />
        </div>
      ) : null}
      {item.actions && item.actions.length > 0 ? (
        <div className="toast-actions">
          {item.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={
                a.quiet ? "toast-link" : a.primary ? "btn primary toast-btn" : "btn toast-btn"
              }
              onClick={() => a.onClick()}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
