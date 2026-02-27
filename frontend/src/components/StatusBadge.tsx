interface Props {
  state: string;
}

const labels: Record<string, string> = {
  on: "Running",
  off: "Stopped",
  suspended: "Suspended",
  starting: "Starting...",
  suspending: "Suspending...",
  provisioning: "Provisioning...",
  error: "Error",
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
          : state === "starting" || state === "suspending" || state === "provisioning"
            ? "badge-starting"
            : state === "error"
              ? "badge-off"
              : "badge-off";

  return <span className={`badge ${cls}`}>{labels[state] || state}</span>;
}
