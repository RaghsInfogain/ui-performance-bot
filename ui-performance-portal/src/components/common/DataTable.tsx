import type { CSSProperties, ReactNode } from 'react';

type DataTableProps = {
  children: ReactNode;
  className?: string;
  tableClassName?: string;
  maxHeight?: string;
  scrollY?: boolean;
};

/** Responsive table shell — fits page width without horizontal scrolling. */
export function DataTable({ children, className = '', tableClassName = '', maxHeight, scrollY }: DataTableProps) {
  const style: CSSProperties | undefined = maxHeight ? { maxHeight } : undefined;
  return (
    <div
      className={`data-table-shell${scrollY ? ' data-table-shell--scroll-y' : ''} ${className}`.trim()}
      style={style}
    >
      <table className={`data-table ${tableClassName}`.trim()}>{children}</table>
    </div>
  );
}
