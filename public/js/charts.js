/** Gráficos leves em CSS (sem biblioteca externa). */
window.CSTrackingCharts = {
  renderBars(container, items, options = {}) {
    if (!container) return;
    const { valueKey = 'count', labelKey = 'week', maxBars = 12, formatValue } = options;

    if (!items?.length) {
      container.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">Sem dados no período</p>';
      return;
    }

    const max = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);

    container.innerHTML = items
      .slice(0, maxBars)
      .map((item) => {
        const val = Number(item[valueKey]) || 0;
        const pct = Math.round((val / max) * 100);
        const label = item[labelKey] ?? '';
        const display = formatValue ? formatValue(val, item) : String(val);
        return `
        <div class="chart-bar-row">
          <span class="chart-bar-label" title="${label}">${label}</span>
          <div class="chart-bar-track">
            <div class="chart-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="chart-bar-value">${display}</span>
        </div>`;
      })
      .join('');
  },

  renderKdLine(container, items) {
    if (!container) return;

    if (!items?.length) {
      container.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">Sem partidas no filtro</p>';
      return;
    }

    const maxKd = Math.max(...items.map((i) => i.kd || 0), 0.1);

    container.innerHTML = `
      <div class="chart-kd-grid">
        ${items
          .map((item) => {
            const h = Math.max(8, Math.round(((item.kd || 0) / maxKd) * 100));
            return `
            <div class="chart-kd-col" title="K/D ${item.kd} · ${item.label}">
              <div class="chart-kd-bar" style="height:${h}%"></div>
              <span class="chart-kd-val">${item.kd}</span>
              <span class="chart-kd-lbl">${item.label}</span>
            </div>`;
          })
          .join('')}
      </div>`;
  },
};
