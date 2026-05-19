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
          <stop offset="0%" stopColor="#258BFF" />
          <stop offset="52%" stopColor="#0C67C8" />
          <stop offset="100%" stopColor="#063D70" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#triallight-crc-mark-fill)" />
      <path
        d="M32 9.8c11.6 0 21 9.4 21 21 0 11.7-9.4 21.1-21 21.1S11 42.5 11 30.8c0-11.6 9.4-21 21-21Z"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.3"
      />
      <path
        d="M45.8 16.2c3.5 2.4 6.1 5.8 7.3 9.8"
        fill="none"
        stroke="#D8ECFF"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
      <circle cx="30" cy="27" r="5.2" fill="none" stroke="#FFFFFF" strokeWidth="3.1" />
      <path
        d="M21.8 42.6c1.6-6.8 5.2-10.2 8.2-10.2s6.6 3.4 8.2 10.2"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.1"
        strokeLinecap="round"
      />
      <path
        d="M43.2 34.8 53 39v5.4c0 5.6-3.5 9-9.8 11.3-6.3-2.3-9.8-5.7-9.8-11.3V39l9.8-4.2Z"
        fill="#0F6EC8"
        stroke="#FFFFFF"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path
        d="M39.6 45.1h7.2M43.2 41.5v7.2"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.5"
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
