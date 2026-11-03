const WHATSAPP_NUMBER = "573193034610";

function whatsappLink(message: string) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function BrandFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`px-4 py-4 text-center text-xs text-brand-muted ${className}`}>
      <p>
        <span className="font-semibold">ComaNet</span> · Desarrollado por{" "}
        <a
          href={whatsappLink("Hola NOVA STUDIO, quiero información sobre ComaNet.")}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-brand-dark hover:underline"
        >
          NOVA STUDIO — Contáctanos
        </a>
      </p>
    </footer>
  );
}
