import React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 items-center rounded-md border px-2 text-xs font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-white",
        outline: "border-border text-foreground",
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const Badge = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(badgeVariants({ variant }), className)}
    {...props}
  />
));
Badge.displayName = "Badge";

export { Badge };
