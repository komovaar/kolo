import { Component } from 'react';
import type { ReactNode } from 'react';

export class WorkspaceBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { window.KoloStartup.fail(); }
  render() { return this.state.failed ? null : this.props.children; }
}
