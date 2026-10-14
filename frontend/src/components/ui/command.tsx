// Adapted from shadcn/ui's new-york Command (MIT); see frontend/NOTICE.md.
import { Command as CommandPrimitive } from 'cmdk';
import type { ComponentProps } from 'react';

export function Command(props: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className="switch-command" {...props} />;
}
export const CommandInput = CommandPrimitive.Input;
export const CommandList = CommandPrimitive.List;
export const CommandItem = CommandPrimitive.Item;
