// The only way the screens reach the computer: a short list of requests, each
// answered by the main process (main.js). The screens get no Node.js, no file
// system and no sign-in token.
const { contextBridge, ipcRenderer } = require('electron');

const ask = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('khozo', {
  state: ask('app:state'),
  setLanguage: ask('app:setLanguage'),
  signIn: ask('session:signIn'),
  signOut: ask('session:signOut'),
  listCases: ask('cases:list'),
  getCase: ask('cases:get'),
  pickFiles: ask('files:pick'),
  listJobs: ask('jobs:list'),
  getJob: ask('jobs:get'),
  createJob: ask('jobs:create'),
  startJob: ask('jobs:start'),
  pauseJob: ask('jobs:pause'),
  removeJob: ask('jobs:remove'),
  decide: ask('jobs:decide'),
  clip: ask('jobs:clip'),
  onJobChanged: (fn) => {
    const listener = (_e, id) => fn(id);
    ipcRenderer.on('jobs:changed', listener);
    return () => ipcRenderer.removeListener('jobs:changed', listener);
  },
});
