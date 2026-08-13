export function load(pane, icon, title, description) {
  const el = document.getElementById(pane + '-pane');
  el.innerHTML = `<div class="stub-pane">
    <i class="ti ${icon}"></i>
    <h3>${title}</h3>
    <p>${description}</p>
  </div>`;
}
