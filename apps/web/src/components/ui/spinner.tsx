import { cn } from "@/lib/utils";
import { Loader2Icon } from "lucide-react";

// Decorative by default: in this app a spinner always sits next to visible
// text ("Scanning…"), and stock shadcn's role="status" would compete with the
// real status messages screen readers (and tests) look for.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      aria-hidden
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
