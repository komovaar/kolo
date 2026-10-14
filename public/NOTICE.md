# Component provenance

`app/core/components/ui/dialog.tsx` adapts the composition of shadcn/ui's `new-york`
Dialog, retrieved from https://ui.shadcn.com/r/styles/new-york/dialog.json.
`app/core/components/ui/command.tsx` adapts shadcn/ui's `new-york` Command from
https://ui.shadcn.com/r/styles/new-york/command.json.

Kolo replaces its Tailwind classes and decorative motion with existing CSS,
omits the default icon dependency, and retains Radix's accessible behavior.

The build includes licenses for bundled npm packages in
`assets/react/LICENSES.txt`. `react-remove-scroll-bar@2.3.8` omits its license
file from the npm tarball. Its local notice includes the standard MIT license
text and attribution from the published package metadata (author Anton
Korzunov), https://registry.npmjs.org/react-remove-scroll-bar/2.3.8.

shadcn/ui is licensed under the MIT License, Copyright (c) 2023 shadcn.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
