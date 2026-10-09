/**
 * chartSetup.js – Chart.js mit gezielten Registrierungen.
 *
 * Nur das Radar-Chart wird verwendet (DuftDNASection). Statt chart.js/auto
 * (registriert alle ~15 Chart-Typen, ~208 kB Chunk) werden hier nur die
 * benötigten Komponenten registriert – deutlich kleinerer Lazy-Chunk.
 */
import {
  Chart,
  RadarController,
  RadialLinearScale,
  LineElement,
  PointElement,
  Filler,
  Legend,
  Tooltip,
} from "chart.js";

Chart.register(RadarController, RadialLinearScale, LineElement, PointElement, Filler, Legend, Tooltip);

export default Chart;
