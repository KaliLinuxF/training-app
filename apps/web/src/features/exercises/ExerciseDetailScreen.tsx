import { useId, useMemo, useState } from 'react';
import { chartGeometry } from '@/lib/stats/chart';
import { LIBRARY_PATH } from '@/lib/workoutRoutes';
import { dataActions, useAppData } from '@/store/data';
import { ui } from '@/store/ui';
import {
  Button,
  Card,
  CardHeader,
  ContentGrid,
  cx,
  LineChart,
  ListGroup,
  ListRow,
  ScreenHeader,
  SectionTitle,
  useBackTo,
} from '@/ui';
import { BodyMap } from './BodyMap';
import { ExerciseEditorSheet } from './ExerciseEditorSheet';
import {
  chartSpeech,
  deleteConfirmBody,
  detailBack,
  detailModel,
  formatMetric,
  type ExerciseDetail,
} from './libraryModel';
import s from './ExerciseDetailScreen.module.css';

export const NOT_FOUND = 'Вправу не знайдено';
export const NO_HISTORY =
  'Ще немає записів цієї вправи. Додай її в тренування — і тут зʼявиться прогрес.';

export interface ExerciseDetailScreenProps {
  id: string;
}

/** The exercise page (`/workouts/library/:id`, phone): «‹ Вправи», the name as <h1>, then the detail. */
export function ExerciseDetailScreen({ id }: ExerciseDetailScreenProps) {
  const data = useAppData();
  const detail = useMemo(() => detailModel(data, id), [data, id]);
  // Read once: the entry she came from (a later navigation inside the page never changes the back target).
  const [back] = useState(() => detailBack(window.history.state));
  const [focusTitle] = useState(() => window.history.state != null);
  return (
    <ContentGrid>
      <ScreenHeader back={back} title={detail ? detail.exercise.name : NOT_FOUND} focusTitle={focusTitle} />
      {detail ? <DetailBody detail={detail} headingLevel="h2" /> : <NotFound />}
    </ContentGrid>
  );
}

export interface ExerciseDetailPaneProps {
  id: string;
  className?: string;
}

/** The same detail as a desktop pane next to the library list: a region named by its <h2>. */
export function ExerciseDetailPane({ id, className }: ExerciseDetailPaneProps) {
  const data = useAppData();
  const detail = useMemo(() => detailModel(data, id), [data, id]);
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx(s.pane, className)}>
      <SectionTitle id={titleId} className={s.paneTitle}>
        {detail ? detail.exercise.name : NOT_FOUND}
      </SectionTitle>
      {detail ? <DetailBody detail={detail} headingLevel="h3" /> : <NotFound />}
    </section>
  );
}

function NotFound() {
  const backTo = useBackTo(LIBRARY_PATH);
  return (
    <Card className={s.notFound}>
      <p className={s.muted}>Можливо, її видалили. Подивись інші вправи в бібліотеці.</p>
      <Button variant="outline" onClick={() => backTo()}>
        До бібліотеки
      </Button>
    </Card>
  );
}

interface DetailBodyProps {
  detail: ExerciseDetail;
  headingLevel: 'h2' | 'h3';
}

function DetailBody({ detail, headingLevel }: DetailBodyProps) {
  const { exercise } = detail;
  const progressId = useId();
  const [editing, setEditing] = useState(false);
  const backTo = useBackTo(LIBRARY_PATH);

  const remove = async () => {
    const confirmed = await ui.confirm({
      title: `Видалити вправу «${exercise.name}»?`,
      body: deleteConfirmBody(detail.workoutsUsing),
      confirmLabel: 'Видалити',
      destructive: true,
    });
    if (!confirmed) return;
    if (dataActions.deleteExercise(exercise.id)) {
      ui.flash('Вправу видалено');
      backTo();
    }
  };

  return (
    <>
      <Card className={s.mapCard}>
        <BodyMap primary={exercise.primary} secondary={exercise.secondary} size="lg" view="both" />
      </Card>

      <Card className={s.factsCard}>
        <dl className={s.facts}>
          {detail.facts.map((f) => (
            <div key={f.label} className={s.fact}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card as="section" aria-labelledby={progressId} gap={10}>
        <CardHeader title="Прогрес" as={headingLevel} titleId={progressId} />
        <ProgressBlock detail={detail} />
      </Card>

      {detail.record && (
        <ListGroup flush aria-label="Рекорди">
          <ListRow icon="trophy" iconTone="acc" title="Рекорди" value={detail.record.text} />
        </ListGroup>
      )}

      {detail.recent.length > 0 && (
        <ListGroup title="Останні тренування">
          {detail.recent.map((r) => (
            <ListRow key={r.sessionId} href={r.href} title={r.title} sub={r.summary} />
          ))}
        </ListGroup>
      )}

      {detail.own && (
        <div className={s.actions}>
          <Button variant="outline" fullWidth onClick={() => setEditing(true)} aria-haspopup="dialog">
            Змінити
          </Button>
          <Button variant="outline" fullWidth className={s.danger} onClick={() => void remove()}>
            Видалити
          </Button>
          <ExerciseEditorSheet
            open={editing}
            exercise={exercise}
            onSaved={() => ui.flash('Збережено')}
            onClose={() => setEditing(false)}
          />
        </div>
      )}
    </>
  );
}

function ProgressBlock({ detail }: { detail: ExerciseDetail }) {
  const { chart } = detail;
  if (!chart) return <p className={s.muted}>{NO_HISTORY}</p>;
  const only = chart.points.length === 1 ? chart.points[0] : undefined;
  return (
    <>
      <p className={s.chartTitle}>{chart.title}</p>
      {only ? (
        <p className={s.single}>{formatMetric(chart.metric, only.value)}</p>
      ) : (
        <LineChart geometry={chartGeometry(chart.points, 120)} height={120} aria-label={chartSpeech(chart)} />
      )}
      {detail.hint && <p className={s.hint}>{detail.hint}</p>}
    </>
  );
}
