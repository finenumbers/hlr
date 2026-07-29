import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductSubmitPage } from '@/components/cabinet/product-submit-page';
import { renderProviders } from '@/test/cabinet-harness';

const tariffMock = vi.fn();
const estimateMock = vi.fn();
const submitCheckMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ tenantId: 'tenant-ui' }),
}));

vi.mock('@/lib/api/client', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
  api: {
    cabinet: {
      tariff: () => tariffMock(),
      estimate: (body: unknown) => estimateMock(body),
      submitCheck: (body: unknown) => submitCheckMock(body),
      submitJob: vi.fn(),
      submitJobCsv: vi.fn(),
    },
  },
}));

describe('ProductSubmitPage UI (tariff states)', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    tariffMock.mockReset();
    estimateMock.mockReset();
    submitCheckMock.mockReset();
    pushMock.mockReset();
  });

  it('none: HLR page shows unavailable + tariff required (no form)', async () => {
    tariffMock.mockResolvedValue({ hlr: null, ping: null });
    render(renderProviders({ children: <ProductSubmitPage checkType="HLR" /> }));

    await waitFor(() => {
      expect(screen.getByText(/HLR unavailable: no tariff assigned/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Ask a platform operator to assign a tariff/i),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('+79991234567')).not.toBeInTheDocument();
  });

  it('hlr-only: HLR form available with unit price', async () => {
    tariffMock.mockResolvedValue({
      hlr: {
        checkType: 'HLR',
        tariffPlanId: 'p1',
        code: 'H1',
        name: 'HLR',
        currency: 'RUB',
        sellPrice: '1.5',
      },
      ping: null,
    });
    render(renderProviders({ children: <ProductSubmitPage checkType="HLR" /> }));

    await waitFor(() => {
      expect(screen.getByText(/Unit price:/i)).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('+79991234567')).toBeInTheDocument();
  });

  it('hlr-only: Ping page stays blocked', async () => {
    tariffMock.mockResolvedValue({
      hlr: {
        checkType: 'HLR',
        tariffPlanId: 'p1',
        code: 'H1',
        name: 'HLR',
        currency: 'RUB',
        sellPrice: '1.5',
      },
      ping: null,
    });
    render(renderProviders({ children: <ProductSubmitPage checkType="PING" /> }));

    await waitFor(() => {
      expect(screen.getByText(/Ping-SMS unavailable: no tariff assigned/i)).toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText('+79991234567')).not.toBeInTheDocument();
  });

  it('ping-only: Ping form available; HLR blocked', async () => {
    tariffMock.mockResolvedValue({
      hlr: null,
      ping: {
        checkType: 'PING',
        tariffPlanId: 'p2',
        code: 'P1',
        name: 'Ping',
        currency: 'RUB',
        sellPrice: '2.5',
      },
    });

    const pingView = render(renderProviders({ children: <ProductSubmitPage checkType="PING" /> }));
    await waitFor(() => {
      expect(within(pingView.container).getByText(/Unit price:/i)).toBeInTheDocument();
    });
    pingView.unmount();

    const hlrView = render(renderProviders({ children: <ProductSubmitPage checkType="HLR" /> }));
    await waitFor(() => {
      expect(within(hlrView.container).getByText(/HLR unavailable: no tariff assigned/i)).toBeInTheDocument();
    });
    expect(within(hlrView.container).queryByPlaceholderText('+79991234567')).not.toBeInTheDocument();
  });

  it('both: submit HLR calls submitCheck with checkType HLR', async () => {
    const user = userEvent.setup();
    tariffMock.mockResolvedValue({
      hlr: {
        checkType: 'HLR',
        tariffPlanId: 'p1',
        code: 'H1',
        name: 'HLR',
        currency: 'RUB',
        sellPrice: '1.5',
      },
      ping: {
        checkType: 'PING',
        tariffPlanId: 'p2',
        code: 'P1',
        name: 'Ping',
        currency: 'RUB',
        sellPrice: '2.5',
      },
    });
    submitCheckMock.mockResolvedValue({ id: 'job-1' });

    const view = render(renderProviders({ children: <ProductSubmitPage checkType="HLR" /> }));
    const phone = await waitFor(() =>
      within(view.container).getByPlaceholderText('+79991234567'),
    );
    await user.type(phone, '+79991234567');
    const submit = within(view.container).getByRole('button', { name: /^Submit$/i });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(submitCheckMock).toHaveBeenCalledWith({
        checkType: 'HLR',
        phones: ['+79991234567'],
      });
    });
    expect(pushMock).toHaveBeenCalledWith('/app/jobs/job-1');
  });
});
