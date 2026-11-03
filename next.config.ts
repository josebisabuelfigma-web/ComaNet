import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Las fotos de productos viajan dentro de la acción del servidor; el
    // límite por defecto (1 MB) es muy bajo para fotos de celular.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
