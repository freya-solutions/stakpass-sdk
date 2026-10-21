import { checkout, payWithkkiapay, redirectToStripe } from './browser';
import { StakPass } from './client';
import { createCart, parsePaymentReturn } from './index';

// <script src=".../stakpass.global.js"></script> then StakPass.init({ publishableKey })
(globalThis as Record<string, unknown>).StakPass = Object.assign(StakPass, {
    createCart,
    parsePaymentReturn,
    checkout,
    payWithkkiapay,
    redirectToStripe,
});
