import { LanguageProvider, useLanguage } from '../contexts/LanguageContext';
import { Home } from './Home';
import { SamlyLogin } from './SamlyLogin';
import { SamlySignup } from './SamlySignup';
import { SamlyLegal } from './SamlyLegal';
import { SamlyFeedback } from './SamlyFeedback';
import { SamlyBilling } from './SamlyBilling';
import { SamlyForgotPassword, SamlyResetPassword } from './SamlyPasswordReset';
import { SamlyEulaAcceptance } from './SamlyEulaAcceptance';

function SamlyRoutes() {
  const { language } = useLanguage();
  const path = window.location.pathname;
  if (path === '/samly/legal' || ['/samly/terms','/samly/privacy','/samly/cancellation','/samly/dpa'].includes(path)) return <SamlyLegal />;
  if (path === '/samly/feedback') return <SamlyFeedback />;
  if (path === '/samly/signup') return <SamlySignup />;
  if (path === '/samly/login') return <SamlyLogin />;
  if (path === '/samly/accept-eula') return <SamlyEulaAcceptance />;
  if (path === '/samly/forgot-password') return <SamlyForgotPassword />;
  if (path === '/samly/reset-password') return <SamlyResetPassword />;
  if (path === '/samly/app') return <SamlyBilling />;
  return <Home />;
}

export function SamlyApp() { return <LanguageProvider><SamlyRoutes /></LanguageProvider>; }
