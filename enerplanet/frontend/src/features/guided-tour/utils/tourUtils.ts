export const buildCurvedPath = (
  tooltipRect: DOMRect, 
  targetRect: DOMRect, 
  placement: string
) => {
  let startX: number, startY: number, endX: number, endY: number;

  // Determine start point (edge of tooltip based on placement)
  switch (placement) {
    case 'left':
      startX = tooltipRect.right;
      startY = tooltipRect.top + tooltipRect.height / 2;
      endX = targetRect.left;
      endY = targetRect.top + targetRect.height / 2;
      break;
    case 'right':
      startX = tooltipRect.left;
      startY = tooltipRect.top + tooltipRect.height / 2;
      endX = targetRect.right;
      endY = targetRect.top + targetRect.height / 2;
      break;
    case 'top':
      startX = tooltipRect.left + tooltipRect.width / 2;
      startY = tooltipRect.bottom;
      endX = targetRect.left + targetRect.width / 2;
      endY = targetRect.top;
      break;
    case 'bottom':
    default:
      startX = tooltipRect.left + tooltipRect.width / 2;
      startY = tooltipRect.top;
      endX = targetRect.left + targetRect.width / 2;
      endY = targetRect.bottom;
      break;
  }

  // Calculate control points for bezier curve
  const dx = endX - startX;
  const dy = endY - startY;

  // S-curve control points
  let cx1: number, cy1: number, cx2: number, cy2: number;

  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal dominant - curve vertically
    cx1 = startX + dx * 0.3;
    cy1 = startY;
    cx2 = endX - dx * 0.3;
    cy2 = endY;
  } else {
    // Vertical dominant - curve horizontally
    cx1 = startX;
    cy1 = startY + dy * 0.3;
    cx2 = endX;
    cy2 = endY - dy * 0.3;
  }

  const path = `M ${startX} ${startY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${endX} ${endY}`;

  return { path, startX, startY, endX, endY };
};
