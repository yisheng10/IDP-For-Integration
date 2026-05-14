import React from 'react';

export default function TrialLightCrcIllustration() {
  return (
    <svg viewBox="0 0 560 520" className="login-portal__illustration" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="triallight-crc-illustration-panel" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F9FCFF" />
          <stop offset="100%" stopColor="#EDF5FC" />
        </linearGradient>
        <linearGradient id="triallight-crc-illustration-accent" x1="20%" y1="0%" x2="86%" y2="100%">
          <stop offset="0%" stopColor="#78B8FF" />
          <stop offset="100%" stopColor="#1E73C9" />
        </linearGradient>
      </defs>

      <rect x="34" y="42" width="492" height="394" rx="34" fill="url(#triallight-crc-illustration-panel)" stroke="#D6E4F2" strokeWidth="2" />
      <rect x="60" y="72" width="154" height="134" rx="24" fill="#FFFFFF" stroke="#D9E7F4" />
      <rect x="238" y="72" width="254" height="74" rx="24" fill="#FFFFFF" stroke="#D9E7F4" />
      <rect x="238" y="160" width="254" height="124" rx="24" fill="#FFFFFF" stroke="#D9E7F4" />
      <rect x="238" y="298" width="254" height="108" rx="24" fill="#FFFFFF" stroke="#D9E7F4" />

      <rect x="82" y="94" width="110" height="14" rx="7" fill="#DDEBFA" />
      <rect x="82" y="120" width="84" height="12" rx="6" fill="#EAF2FB" />
      <rect x="82" y="154" width="56" height="30" rx="15" fill="#EAF4FF" stroke="#D6E7F7" />

      <rect x="264" y="94" width="152" height="12" rx="6" fill="#DDEBFA" />
      <rect x="264" y="118" width="194" height="12" rx="6" fill="#EAF2FB" />
      <rect x="264" y="184" width="112" height="12" rx="6" fill="#DDEBFA" />
      <rect x="264" y="208" width="178" height="12" rx="6" fill="#EAF2FB" />
      <rect x="264" y="232" width="146" height="12" rx="6" fill="#EAF2FB" />
      <rect x="264" y="324" width="132" height="12" rx="6" fill="#DDEBFA" />
      <rect x="264" y="348" width="174" height="12" rx="6" fill="#EAF2FB" />

      <circle cx="158" cy="354" r="58" fill="#E8F2FD" />
      <circle cx="338" cy="364" r="46" fill="#EFF6FD" />

      <circle cx="148" cy="300" r="26" fill="#0F609B" />
      <path
        d="M116 388c8-30 21-48 32-48s24 18 32 48"
        fill="none"
        stroke="#0F609B"
        strokeWidth="16"
        strokeLinecap="round"
      />

      <circle cx="338" cy="318" r="20" fill="#78B8FF" />
      <path
        d="M316 390c7-24 16-38 22-38s15 14 22 38"
        fill="none"
        stroke="#78B8FF"
        strokeWidth="14"
        strokeLinecap="round"
      />

      <rect x="187" y="276" width="88" height="124" rx="22" fill="#FFFFFF" stroke="#D8E5F3" />
      <rect x="202" y="296" width="58" height="76" rx="14" fill="#F1F7FD" stroke="#DCE8F4" />
      <circle cx="231" cy="387" r="5" fill="#B7D3EE" />

      <path d="M418 192c18 8 30 22 36 40" fill="none" stroke="#9BC9F7" strokeWidth="4" strokeLinecap="round" />
      <path d="M424 214c8 4 14 11 17 20" fill="none" stroke="#9BC9F7" strokeWidth="4" strokeLinecap="round" />
      <path d="M452 92h22M463 81v22" fill="none" stroke="url(#triallight-crc-illustration-accent)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

