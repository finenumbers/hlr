import { redirect } from 'next/navigation';

/** Legacy overview URL — product pages live under /submit/hlr and /submit/ping. */
export default function SubmitOverviewPage() {
  redirect('/app/submit/hlr');
}
