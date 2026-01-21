import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> & {
  label: string;
  title?: string;
  className?: string;
  children: ReactNode;
};

export function IconButton({ label, title, className, children, ...props }: IconButtonProps) {
  const mergedClassName = ["icon-button", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={mergedClassName} aria-label={label} title={title ?? label} {...props}>
      {children}
    </button>
  );
}

