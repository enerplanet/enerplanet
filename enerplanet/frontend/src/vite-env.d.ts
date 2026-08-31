/// <reference types="vite/client" />

import "react";

// Mirror @radix-ui/react-primitive's CSSProperties augmentation so the two
// React type instances (libs/ + frontend/) stay structurally identical.
declare module "react" {
  interface CSSProperties {
    [varName: `--radix-${string}`]: string | number | undefined | null;
  }
}