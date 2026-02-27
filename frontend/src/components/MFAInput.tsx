import { useState, useRef, useEffect } from "react";

interface Props {
  onSubmit: (code: string) => void;
  error?: string | null;
  loading?: boolean;
}

export default function MFAInput({ onSubmit, error, loading }: Props) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const next = [...digits];
    next[index] = value.slice(-1);
    setDigits(next);

    if (value && index < 5) {
      refs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits filled
    const code = next.join("");
    if (code.length === 6) {
      onSubmit(code);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    const next = [...digits];
    for (let i = 0; i < text.length; i++) {
      next[i] = text[i];
    }
    setDigits(next);
    if (text.length === 6) {
      onSubmit(text);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            disabled={loading}
            style={{
              width: 48,
              height: 56,
              textAlign: "center",
              fontSize: 24,
              fontWeight: 700,
            }}
          />
        ))}
      </div>
      {error && <p className="error-msg" style={{ textAlign: "center", marginTop: 12 }}>{error}</p>}
    </div>
  );
}
