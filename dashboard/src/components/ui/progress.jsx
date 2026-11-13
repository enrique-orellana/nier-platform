import React from "react";
import { cn } from "../../lib/utils";

const Progress = React.forwardRef(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const percentage =
      max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-white/10",
          className,
        )}
        {...props}
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };
