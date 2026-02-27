interface Props {
  state: string;
}

const labels: Record<string, string> = {
  on: "Running",
  off: "Stopped",
  suspended: "Suspended",
  starting: "Starting...",
  suspending: "Suspending...",
  unknown: "Unknown",
};

export default function StatusBadge({ state }: Props) {
  const cls =
    state === "on"
      ? "badge-on"
      : state === "off"
        ? "badge-off"
        : state === "suspended"
          ? "badge-suspended"
          : state === "starting" || state === "suspending"
            ? "badge-starting"
            : "badge-off";

  return <span className={`badge ${cls}`}>{labels[state] || state}</span>;
}
