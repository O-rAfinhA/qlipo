import Link from "next/link";

import { getJob } from "@/server/job-store";

export default async function ProcessingPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
      <div className="mx-auto max-w-2xl rounded-[32px] border border-white/10 bg-white/6 p-8">
        <p className="text-xs uppercase tracking-[0.32em] text-cyan-200">Job de renderizacao</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Qlipo processando seu projeto</h1>
        <p className="mt-4 text-sm text-zinc-400">Acompanhe esta rota em paralelo ao editor principal. O painel da home continua sendo a interface principal.</p>
        <div className="mt-6 rounded-3xl border border-white/10 bg-black/20 p-5">
          <p className="text-sm text-zinc-400">Job</p>
          <p className="mt-2 font-mono text-sm text-zinc-100">{jobId}</p>
          <p className="mt-4 text-sm text-zinc-400">Status atual</p>
          <p className="mt-2 text-lg font-semibold text-white">{job?.message ?? "Aguardando informacoes do job."}</p>
        </div>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-orange-200 underline">
          Voltar ao editor
        </Link>
      </div>
    </main>
  );
}
