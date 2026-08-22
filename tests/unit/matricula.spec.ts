import { test, expect } from '@playwright/test';
import {
  corteMatricula, matriculaAbierta, estadoCurso, ahoraEnChile, hoyEnChile,
  GRACIA_MATRICULA_DIAS, HORA_CIERRE_MATRICULA,
  parseHorarioRango, horariosSeSolapan, campaignNameToDate, addMonths,
} from '../../src/lib/cursos-campaign';

/** Instante correspondiente a una hora local de Chile, como Date absoluto. */
function enChile(iso: string, hhmm: string): Date {
  // Se busca el instante UTC cuya representación en Chile sea la pedida.
  // Basta probar los dos offsets posibles (-3 y -4) y quedarse con el que cuadra.
  for (const off of [3, 4]) {
    const d = new Date(`${iso}T${hhmm}:00.000Z`);
    d.setUTCHours(d.getUTCHours() + off);
    if (ahoraEnChile(d) === `${iso}T${hhmm}`) return d;
  }
  throw new Error(`no se pudo construir ${iso} ${hhmm} de Chile`);
}

test.describe('Cierre de matrícula — del lunes que empieza el curso al lunes siguiente, 09:00 de Chile', () => {
  test('las constantes son las acordadas', () => {
    expect(GRACIA_MATRICULA_DIAS).toBe(7);
    expect(HORA_CIERRE_MATRICULA).toBe(9);
  });

  test('el curso empieza un lunes → cierra el lunes siguiente', () => {
    expect(corteMatricula('2026-08-10')).toBe('2026-08-17T09:00'); // lun → lun
    expect(corteMatricula('2026-08-17')).toBe('2026-08-24T09:00'); // AGOSTO172026M
    expect(corteMatricula('2026-10-19')).toBe('2026-10-26T09:00'); // 0CTUBRE192026M
  });

  test('el corte SIEMPRE cae en lunes, empiece el curso el día que empiece', () => {
    // Dentro de una campaña cada horario se reúne por primera vez otro día
    // (LUN-MIÉ el lunes, MAR-JUE el martes, SÁB el sábado): todos cierran el
    // mismo lunes, el siguiente al de su semana.
    for (const dia of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
                       '2026-08-21', '2026-08-22', '2026-08-23']) {
      expect(corteMatricula(dia)).toBe('2026-08-24T09:00');
    }
    // El lunes siguiente ya pertenece a la semana siguiente.
    expect(corteMatricula('2026-08-24')).toBe('2026-08-31T09:00');
  });

  test('el corte cruza fin de mes y fin de año', () => {
    expect(corteMatricula('2026-08-30')).toBe('2026-08-31T09:00'); // domingo 30 → su lunes es el 24
    expect(corteMatricula('2026-12-28')).toBe('2027-01-04T09:00'); // lunes 28 → lunes 4
  });

  test('la semana se cuenta en calendario, no en horas: el cambio de horario de Chile no la mueve', () => {
    // En agosto Chile va en -4 y en enero en -3. La fecha del corte es la misma
    // cuenta de días en ambos casos; lo que cambia es a qué hora UTC ocurre.
    expect(corteMatricula('2026-01-12')).toBe('2026-01-19T09:00'); // lun ene
    expect(corteMatricula('2026-08-10')).toBe('2026-08-17T09:00'); // lun ago
  });

  test('el día que empieza el curso y los 6 siguientes siguen en matrícula', () => {
    for (let d = 0; d <= 6; d++) {
      const fecha = new Date(Date.UTC(2026, 7, 10 + d));
      const iso = fecha.toISOString().slice(0, 10);
      expect(matriculaAbierta('2026-08-10', enChile(iso, '12:00'))).toBe(true);
    }
  });

  test('a las 08:59 del día 7 todavía es matrícula; a las 09:00 exactas ya no', () => {
    expect(matriculaAbierta('2026-08-10', enChile('2026-08-17', '08:59'))).toBe(true);
    expect(matriculaAbierta('2026-08-10', enChile('2026-08-17', '09:00'))).toBe(false);
  });

  test('el veredicto es el mismo se mire desde donde se mire', () => {
    // El corte son las 09:00 DE CHILE, no del reloj de quien consulta: se compara
    // el instante, así que un usuario en Colombia o en España ve lo mismo.
    const instante = enChile('2026-08-17', '08:59');
    expect(matriculaAbierta('2026-08-10', instante)).toBe(true);
    expect(matriculaAbierta('2026-08-10', new Date(instante.getTime() + 60_000))).toBe(false);
  });

  test('sin fecha de inicio la matrícula no está abierta', () => {
    expect(matriculaAbierta(null)).toBe(false);
    expect(matriculaAbierta('')).toBe(false);
  });
});

test.describe('Estado del curso — cerrado gana a matrícula', () => {
  const ahora = enChile('2026-08-12', '12:00');

  test('un curso terminado está cerrado aunque su matrícula siga en gracia', () => {
    expect(estadoCurso({ finalCurso: '2026-08-01', inicioCurso: '2026-08-10' }, ahora)).toBe('cerrado');
  });

  test('dentro de la semana y con el curso vivo: en matrícula', () => {
    // Empezó el lunes 10 y hoy es miércoles 12: cierra el lunes 17.
    expect(estadoCurso({ finalCurso: '2027-06-01', inicioCurso: '2026-08-10' }, ahora)).toBe('matricula');
  });

  test('el inicio de la CAMPAÑA manda sobre el del curso', () => {
    // Un curso de sábado de la campaña que arrancó el lunes 10 cierra con ella,
    // no una semana más tarde por reunirse por primera vez el sábado.
    expect(estadoCurso({ finalCurso: '2027-06-01', inicioCurso: '2026-08-15', inicioCampanaCursos: '2026-08-10' }, ahora)).toBe('matricula');
  });

  test('pasada la semana y con el curso vivo: activo', () => {
    expect(estadoCurso({ finalCurso: '2027-06-01', inicioCurso: '2026-07-01' }, ahora)).toBe('activo');
  });

  test('un curso que todavía NO empieza también está en matrícula', () => {
    // La ventana va desde antes del inicio hasta una semana después: hasta que
    // arranca no hay nada que cierre la matrícula.
    expect(estadoCurso({ finalCurso: '2027-06-01', inicioCurso: '2026-10-19' }, ahora)).toBe('matricula');
  });

  test('el día de hoy en Chile se calcula sobre el instante, no sobre el reloj local', () => {
    expect(hoyEnChile(ahora)).toBe('2026-08-12');
  });
});

test.describe('Horarios — la regla con la que chocan dos cursos del mismo guía', () => {
  test('parsea días y rango en minutos', () => {
    const r = parseHorarioRango('LUN-MIÉ 17:00-18:00');
    expect(r).not.toBeNull();
    expect(r!.dias).toEqual([1, 3]);
    expect(r!.inicioMin).toBe(17 * 60);
    expect(r!.finMin).toBe(18 * 60);
  });

  test('tolera la falta de tilde', () => {
    expect(parseHorarioRango('LUN-MIE 17:00-18:00')!.dias).toEqual([1, 3]);
  });

  test('terminar justo cuando el otro empieza NO es choque', () => {
    expect(horariosSeSolapan('SÁB 09:00-11:00', 'SÁB 11:00-13:00')).toBe(false);
  });

  test('solaparse aunque sea una hora sí lo es', () => {
    expect(horariosSeSolapan('SÁB 09:00-11:00', 'SÁB 10:00-12:00')).toBe(true);
  });

  test('sin día en común no hay choque aunque la hora coincida', () => {
    expect(horariosSeSolapan('LUN-MIÉ 17:00-18:00', 'MAR-JUE 17:00-18:00')).toBe(false);
  });

  test('basta con compartir UN día', () => {
    // IMPULSA va LUN-MIÉ-VIE y SENPAI LUN-MIÉ: chocan por lunes y miércoles.
    expect(horariosSeSolapan('LUN-MIÉ-VIE 20:00-21:00', 'LUN-MIÉ 20:00-20:50')).toBe(true);
  });

  test('un horario ilegible no inventa un choque', () => {
    expect(parseHorarioRango('lunes 5pm')).toBeNull();
    expect(horariosSeSolapan('lunes 5pm', 'SÁB 09:00-11:00')).toBe(false);
  });
});

test.describe('Nombre de campaña y vigencias', () => {
  test('la fecha embebida se lee con el sufijo de marca', () => {
    expect(campaignNameToDate('AGOSTO172026M')).toBe('2026-08-17');
    expect(campaignNameToDate('AGOSTO102026I')).toBe('2026-08-10');
  });

  test('un nombre que no sigue el formato no revienta', () => {
    expect(campaignNameToDate('SINCAMPAIGN')).toBeNull();
  });

  test('sumar meses respeta el desborde de fin de mes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-17', 12)).toBe('2027-08-17');
  });
});
