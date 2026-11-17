import { local, session } from './storage.js';
import { V, state, AUTO_LOCK_MS, syncPublicAccounts } from './ui.js';
import './views/onboarding.js';
import './views/home.js';
import './views/send.js';
import './views/swap.js';
import './views/stake.js';
import './views/settings.js';
import './views/approve.js';

async function init() {
  const requestId = new URLSearchParams(location.search).get('request');
  if (requestId) document.body.classList.add('window');

  const saved = await local.get('settings');
  if (saved) Object.assign(state.settings, saved);
  const vault = await local.get('vault');
  if (!vault) return V.welcome();

  const next = requestId ? () => V.approve(requestId) : V.home;
  const unlocked = await session.get('unlocked');
  if (unlocked && Date.now() - unlocked.lastActive < AUTO_LOCK_MS) {
    state.secret = unlocked.secret;
    await syncPublicAccounts();
    return next();
  }
  await session.remove('unlocked');
  if (requestId) state.afterUnlock = next;
  V.unlock();
}

init();
