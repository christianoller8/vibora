import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResumenMetricas } from '../../../shared/models/metricas.model';
import { TarjetasKpi } from './tarjetas-kpi';

const RESUMEN: ResumenMetricas = {
  desde: '2026-11-01',
  hasta: '2026-11-30',
  ingresos: 1234.5,
  reservasConfirmadas: 40,
  reservasCanceladas: 5,
  tasaCancelacion: 0.1111,
  ticketMedio: null,
  ingresosPerdidosPorCancelacion: 120,
  ocupacionGlobal: 0.452,
  facturado: {
    base: 1000,
    cuotaIva: 210,
    total: 1210,
    numeroFacturas: 12,
    numeroRectificativas: 0,
  },
};

describe('TarjetasKpi', () => {
  let fixture: ComponentFixture<TarjetasKpi>;

  async function crear(resumen: ResumenMetricas): Promise<void> {
    await TestBed.configureTestingModule({ imports: [TarjetasKpi] }).compileComponents();
    fixture = TestBed.createComponent(TarjetasKpi);
    fixture.componentRef.setInput('resumen', resumen);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const tarjeta = (clave: string): HTMLElement | null =>
    el().querySelector(`[data-kpi="${clave}"]`);

  it('pinta una tarjeta por cifra del resumen, con su título y su valor', async () => {
    await crear(RESUMEN);

    expect(el().querySelectorAll('[data-kpi]')).toHaveLength(8);
    expect(tarjeta('ingresos')?.querySelector('dt')?.textContent).toContain('Ingresos');
    expect(tarjeta('ingresos')?.querySelector('dd')?.textContent).toContain('1.234,50 €');
    expect(tarjeta('confirmadas')?.querySelector('dd')?.textContent).toContain('40');
    expect(tarjeta('ocupacion')?.querySelector('dd')?.textContent).toContain('45,2 %');
  });

  it('lo no calculable sale como raya', async () => {
    await crear(RESUMEN);
    expect(tarjeta('ticket')?.querySelector('dd')?.textContent).toContain('—');
  });

  it('lo facturado lleva su detalle (base, IVA, facturas)', async () => {
    await crear(RESUMEN);
    expect(tarjeta('facturado')?.textContent).toContain('12 facturas');
    expect(tarjeta('ingresos')?.querySelector('.detalle')).toBeNull();
  });
});
