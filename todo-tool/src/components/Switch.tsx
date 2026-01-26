type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void | Promise<void>;
  disabled?: boolean;
  ariaLabel?: string;
};

export function Switch({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: SwitchProps) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "switch-on" : ""} ${
        disabled ? "switch-disabled" : ""
      }`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return;
        void onChange(!checked);
      }}
    >
      <span className="switch-thumb" />
    </button>
  );
}
