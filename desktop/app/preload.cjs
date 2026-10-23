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
  syncNow: ask('jobs:syncNow'),
  downloadUpdate: ask('update:download'),
  installUpdate: ask('update:install'),
  decide: ask('jobs:decide'),
  decideLead: ask('jobs:decideLead'),
  openCaseCount: ask('openCases:count'),
  clip: ask('jobs:clip'),
  onUpdateChanged: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('update:changed', listener);
    return () => ipcRenderer.removeListener('update:changed', listener);
  },
  onSessionEnded: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('session:ended', listener);
    return () => ipcRenderer.removeListener('session:ended', listener);
  },
  onJobChanged: (fn) => {
    const listener = (_e, id) => fn(id);
    ipcRenderer.on('jobs:changed', listener);
    return () => ipcRenderer.removeListener('jobs:changed', listener);
  },
});
