import { useEffect, useState } from 'react';
import { fmtDateTime, fmtNum } from '../lib/format.js';
import { Button, Logo, Paragraphs, Spinner } from '../lib/ui.jsx';

export default function ResultView({ attempt, testMode, finishMessage, organization, onRefresh, onReset }) {
  const r = attempt.result || {};
  const pending = !r.hidden && r.pending;
  const [busy, setBusy] = useState(false);

  // Đang chờ chấm tự luận: tự kiểm tra lại mỗi 15 giây
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => onRefresh().catch(() => {}), 15_000);
    return () => clearInterval(t);
  }, [pending, onRefresh]);

  let banner;
  if (r.hidden) {
    banner = <div className="rounded-xl bg-blue-50 py-6 text-2xl font-bold text-blue-800">ĐÃ NỘP BÀI</div>;
  } else if (pending) {
    banner = (
      <div className="rounded-xl bg-amber-50 py-6 text-amber-800">
        <div className="text-2xl font-bold">ĐANG CHỜ CHẤM TỰ LUẬN</div>
        <div className="mt-1 flex items-center justify-center gap-2 text-xs">
          <Spinner /> Trang tự cập nhật khi có kết quả
        </div>
      </div>
    );
  } else if (r.result === 'pass') {
    banner = <div className="rounded-xl bg-emerald-50 py-6 text-3xl font-bold text-emerald-700">ĐẠT</div>;
  } else {
    banner = <div className="rounded-xl bg-red-50 py-6 text-3xl font-bold text-red-700">KHÔNG ĐẠT</div>;
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <div className="overflow-hidden rounded-2xl bg-white text-center shadow-lg ring-1 ring-slate-200/60">
        <div className="bg-brand h-2" />
        <div className="space-y-5 p-6">
        <div className="flex justify-center">
          <Logo className="h-16" />
        </div>
        {organization && <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{organization}</div>}
        <h1 className="text-lg font-bold text-slate-900">{attempt.title}</h1>
        {banner}
        {r.tabViolation && <p className="text-sm font-medium text-red-700">Bài bị tự nộp do rời khỏi trang làm bài (chuyển tab).</p>}

        {!r.hidden && (
          <div className="grid grid-cols-2 gap-3 text-left text-sm">
            <Item label="Tổng điểm" value={pending ? 'Chưa có' : `${fmtNum(r.totalScore)} / ${fmtNum(r.maxScore)}`} />
            <Item label="Thang 10" value={pending ? 'Chưa có' : fmtNum(r.score10)} />
            {r.mcTotal > 0 && (
              <>
                <Item label="Trắc nghiệm đúng" value={`${r.mcCorrect}/${r.mcTotal} câu`} />
                <Item label="Trắc nghiệm sai" value={`${r.mcTotal - r.mcCorrect} câu`} />
              </>
            )}
            <Item label="Điều kiện đạt" value={`Từ ${fmtNum(r.passingScore)} / 10`} />
            <Item label="Đã trả lời" value={`${attempt.answeredCount}/${attempt.questionCount} câu`} />
          </div>
        )}

        <div className="space-y-1 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <div>
            <b>{attempt.name}</b> · {attempt.email}
          </div>
          <div>Nộp lúc {fmtDateTime(attempt.submittedAt)}</div>
          {attempt.submitReasonLabel && <div>Lý do: {attempt.submitReasonLabel}</div>}
          {r.hidden && <div>Kết quả sẽ được thông báo sau.</div>}
        </div>

        {finishMessage && <Paragraphs text={finishMessage} className="rounded-lg bg-blue-50 px-4 py-3 text-left text-sm text-blue-900" />}

        {testMode && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onReset().finally(() => setBusy(false));
            }}
          >
            Làm lại (chế độ thử)
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}

function Item({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
