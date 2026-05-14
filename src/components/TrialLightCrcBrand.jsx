import React from 'react';

export function TrialLightCrcMark({ size = 48, className = '' }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="triallight-crc-mark-fill" x1="14%" y1="10%" x2="88%" y2="90%">
          <stop offset="0%" stopColor="#2B8CFF" />
          <stop offset="100%" stopColor="#0B4F82" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="20" fill="url(#triallight-crc-mark-fill)" />
      <path
        d="M32 12 18.5 18.5v10.2c0 9.1 5.7 16 13.5 18.8 7.8-2.8 13.5-9.7 13.5-18.8V18.5L32 12Z"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="24.5" r="5.5" fill="none" stroke="#FFFFFF" strokeWidth="3" />
      <path
        d="M24.4 39.6c1.9-5.1 5.2-7.6 7.6-7.6 2.4 0 5.7 2.5 7.6 7.6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M44 22h6M47 19v6"
        fill="none"
        stroke="#D7ECFF"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TrialLightCrcWordmark({ className = '', subline = 'CRC Portal' }) {
  return (
    <div className={`triallight-crc-brand ${className}`.trim()}>
      <TrialLightCrcMark size={56} className="triallight-crc-brand__mark" />
      <div className="triallight-crc-brand__copy">
        <div className="triallight-crc-brand__name">TrialLight</div>
        <div className="triallight-crc-brand__subline">{subline}</div>
      </div>
    </div>
  );
}

