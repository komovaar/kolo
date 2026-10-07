// The host owns terminal query answers. A viewer's parser still applies output
// modes, but must not send automatic answers into a PTY shared by other viewers.
globalThis.KoloTerminalQueries = {
  hostReplies(term) {
    const parser = term.parser;
    for (const id of [
      { final: 'c' }, { prefix: '>', final: 'c' }, { prefix: '=', final: 'c' },
      { final: 'n' }, { prefix: '?', final: 'n' },
      { intermediates: '$', final: 'p' }, { prefix: '?', intermediates: '$', final: 'p' },
    ]) parser.registerCsiHandler(id, () => true);
    parser.registerEscHandler({ final: 'Z' }, () => true);
    parser.registerCsiHandler({ final: 't' }, (params) => [14, 16, 18, 19, 20, 21].includes(params[0]));
    parser.registerDcsHandler({ intermediates: '$', final: 'q' }, () => true);
    for (const command of [4, 10, 11, 12]) {
      parser.registerOscHandler(command, (data) => data.split(';').includes('?'));
    }
  },
};
