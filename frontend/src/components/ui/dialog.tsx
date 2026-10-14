// Adapted from shadcn/ui's new-york Dialog (MIT); see frontend/NOTICE.md.
// Keep its Radix composition and replace default styling with Kolo tokens.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useRef } from 'react';
import type { ComponentProps, ReactNode } from 'react';

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({ open, children, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { open: boolean; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  return <div className="scrim" hidden={!open} ref={container}>
    <DialogPrimitive.Portal container={container.current}>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className="dialog" {...props}>{children}</DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </div>;
}
