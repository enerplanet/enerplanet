/**
 * Host page wrapper (host seam — app imports allowed here only).
 * Route: /app/node-modeller
 */
import { useMemo } from "react";
import { NodeModeller } from "../components/NodeModeller";
import { createAppAdapter } from "./createAppAdapter";

export default function NodeModellerPage() {
  const api = useMemo(() => createAppAdapter(), []);
  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      <NodeModeller api={api} />
    </div>
  );
}
