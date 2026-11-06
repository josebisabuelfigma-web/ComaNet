/**
 * Mensajes de WhatsApp para el cliente de un pedido. Son solo texto
 * prellenado: el chat se abre y la persona decide si lo envía, así que
 * ninguno bloquea ni cambia el estado del pedido.
 */
type MessageOrder = {
  status: string;
  completed_at: string | null;
  order_number: number;
  customer_name: string | null;
  fulfillment?: string | null;
};

function greeting(name: string | null | undefined) {
  const clean = (name ?? "").trim();
  return clean ? `Hola ${clean}` : "Hola";
}

export type OrderMessageKind = "recibido" | "en_camino" | "cerrado" | "general";

export function orderMessageKind(order: Pick<MessageOrder, "status" | "completed_at">): OrderMessageKind {
  if (order.status === "pendiente") return "recibido";
  if (order.status === "despachado" && !order.completed_at) return "en_camino";
  if (order.status === "pagada" || (order.status === "despachado" && order.completed_at)) return "cerrado";
  return "general";
}

export function orderWhatsappMessage(order: MessageOrder, kind: OrderMessageKind = orderMessageKind(order)) {
  const hi = greeting(order.customer_name);
  const pickup = order.fulfillment === "recoger";
  switch (kind) {
    case "recibido":
      return `${hi}, recibimos tu pedido. Antes de enviarlo a preparar, ¿quieres hacer algún cambio?`;
    case "en_camino":
      return pickup
        ? `${hi}, tu pedido ya está listo para que lo recojas.`
        : `${hi}, tu pedido va en camino.`;
    case "cerrado":
      return `${hi}, tu pedido está cerrado. Fue un gusto atenderte, ¡esperamos verte pronto!`;
    default:
      return `${hi}, te escribimos por tu pedido.`;
  }
}

/** Texto corto del enlace en la tarjeta, según lo que dirá el mensaje. */
export function orderWhatsappHint(kind: OrderMessageKind) {
  switch (kind) {
    case "recibido":
      return "preguntar si quiere cambios";
    case "en_camino":
      return "avisar que va en camino";
    case "cerrado":
      return "avisar que se cerró";
    default:
      return "abrir WhatsApp";
  }
}
