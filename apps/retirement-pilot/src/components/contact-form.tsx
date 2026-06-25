"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

type Status = "idle" | "submitting" | "done";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    // Pilot site: no backend wired yet. Simulate a submission so the flow is
    // demonstrable end-to-end. Swap in a server action / email service later.
    window.setTimeout(() => setStatus("done"), 700);
  }

  if (status === "done") {
    return (
      <div className="flex flex-col items-center gap-4 rounded-3xl bg-forest-soft p-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-forest text-cream">
          <Check className="size-7" />
        </span>
        <h3 className="font-serif text-2xl font-semibold text-forest-deep">
          Thank you!
        </h3>
        <p className="max-w-sm text-ink/75">
          We&apos;ve received your request and a member of our team will reach
          out within one business day to help you plan a visit.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          required
        />
      </div>
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
      />
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink/80">
          I&apos;m interested in
        </span>
        <select
          name="interest"
          className="rounded-xl border border-border bg-white px-4 py-3 text-ink outline-none transition focus:border-forest focus:ring-2 focus:ring-forest/20"
          defaultValue="assisted-living"
        >
          <option value="assisted-living">Assisted living</option>
          <option value="respite-care">Respite / short-term care</option>
          <option value="tour">A community tour</option>
          <option value="pricing">Pricing & availability</option>
          <option value="other">Something else</option>
        </select>
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-ink/80">
          Message <span className="text-muted">(optional)</span>
        </span>
        <textarea
          name="message"
          rows={4}
          placeholder="Tell us a little about who you're looking for care for, and any questions you have."
          className="resize-none rounded-xl border border-border bg-white px-4 py-3 text-ink outline-none transition placeholder:text-muted/70 focus:border-forest focus:ring-2 focus:ring-forest/20"
        />
      </label>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-forest px-6 py-3.5 text-base font-semibold text-cream transition-colors hover:bg-forest-deep disabled:opacity-70"
      >
        {status === "submitting" ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            Sending…
          </>
        ) : (
          "Request a visit"
        )}
      </button>
      <p className="text-center text-xs text-muted">
        We respect your privacy. Your information is only used to respond to your
        request.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-ink/80">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        autoComplete={autoComplete}
        className="rounded-xl border border-border bg-white px-4 py-3 text-ink outline-none transition focus:border-forest focus:ring-2 focus:ring-forest/20"
      />
    </label>
  );
}
