/// <reference types="vite/client" />

import "react";
declare module "react" {
  interface CSSProperties {
    [varName: `--radix-${string}`]: string | number | undefined | null;
  }
}

// Allow importing CSS modules without TS errors
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.module.scss" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
