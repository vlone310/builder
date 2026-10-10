import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import {
  Dialog as RadixDialog,
  Select as RadixSelect,
  Switch as RadixSwitch,
  Tabs as RadixTabs,
} from "radix-ui";
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

export const cx = clsx;

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-blue-700 disabled:bg-blue-300",
  secondary: "border border-line bg-white text-ink hover:bg-slate-50 disabled:text-muted",
  ghost: "text-ink hover:bg-slate-100 disabled:text-slate-300",
  danger: "text-danger hover:bg-red-50",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "icon" }
>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed",
        size === "sm" && "h-7 px-2 text-xs",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "icon" && "h-7 w-7",
        buttonStyles[variant],
        className,
      )}
      {...props}
    />
  );
});

const fieldClass =
  "w-full rounded-md border border-line bg-white px-2 py-1.5 text-[13px] text-ink placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cx(fieldClass, "h-8", className)} {...props} />;
  },
);

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(fieldClass, "min-h-20 resize-y", className)} {...props} />;
}

export function Label({
  children,
  htmlFor,
  hint,
}: {
  children: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600"
    >
      <span>{children}</span>
      {hint}
    </label>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  id,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  id?: string;
}) {
  return (
    <RadixSelect.Root
      {...(value !== undefined && value !== "" ? { value } : {})}
      onValueChange={onValueChange}
    >
      <RadixSelect.Trigger
        id={id}
        className={cx(fieldClass, "flex h-8 items-center justify-between")}
      >
        <RadixSelect.Value placeholder={placeholder ?? "Select…"} />
        <RadixSelect.Icon>
          <ChevronDown size={14} className="text-muted" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line bg-white shadow-lg"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center rounded px-2 py-1.5 pl-6 text-[13px] outline-none data-[highlighted]:bg-accent-soft"
              >
                <RadixSelect.ItemIndicator className="absolute left-1.5">
                  <Check size={12} />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  id?: string;
}) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="relative h-5 w-9 rounded-full bg-slate-300 transition-colors data-[state=checked]:bg-accent"
    >
      <RadixSwitch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RadixSwitch.Root>
  );
}

export const Tabs = {
  Root: RadixTabs.Root,
  List: ({ children }: { children: ReactNode }) => (
    <RadixTabs.List className="flex border-b border-line px-2">{children}</RadixTabs.List>
  ),
  Trigger: ({ value, children }: { value: string; children: ReactNode }) => (
    <RadixTabs.Trigger
      value={value}
      className="-mb-px border-b-2 border-transparent px-2 py-2 text-xs font-medium text-muted data-[state=active]:border-accent data-[state=active]:text-ink"
    >
      {children}
    </RadixTabs.Trigger>
  ),
  Content: RadixTabs.Content,
};

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-xl">
          <RadixDialog.Title className="mb-3 text-sm font-semibold">{title}</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: "info" | "warn" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "flex items-center gap-2 border-b px-4 py-2 text-xs",
        tone === "info" && "border-blue-200 bg-blue-50 text-blue-900",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "danger" && "border-red-200 bg-red-50 text-red-900",
      )}
    >
      {children}
    </div>
  );
}
