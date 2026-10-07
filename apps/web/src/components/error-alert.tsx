import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

/**
 * The one way to show a failed request. Renders role="alert", so screen
 * readers announce it and tests can find it by role.
 */
export function ErrorAlert({
  title,
  children,
  className,
}: {
  /** Optional bold first line; the message itself goes in children. */
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Alert
      variant="destructive"
      className={cn("border-destructive/30 bg-destructive/5", className)}
    >
      <AlertCircle />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className="break-words">{children}</AlertDescription>
    </Alert>
  );
}
