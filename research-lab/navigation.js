// Navigation only: no identity, storage, network, analytics or app state access.
(() => {
  const shell = document.querySelector('.dd-shell');
  if (!shell) return;
  const menus = [...shell.querySelectorAll('details')];
  shell.addEventListener('toggle', event => {
    if (event.target.open) menus.forEach(menu => { if (menu !== event.target) menu.open = false; });
  }, true);
  shell.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = menus.find(menu => menu.open);
    if (open) { open.open = false; open.querySelector('summary').focus(); event.preventDefault(); }
  });
  document.addEventListener('click', event => {
    if (!shell.contains(event.target)) menus.forEach(menu => { menu.open = false; });
  });
})();
