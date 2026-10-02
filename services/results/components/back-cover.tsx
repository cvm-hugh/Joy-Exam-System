// Protected uploaded assets need the browser's session cookie, not an image optimizer request.
/* oxlint-disable next/no-img-element */
import type { Config } from '@/lib/domain';
type Cover = Pick<
  Config,
  'coverBackgroundImage' | 'coverQrImage' | 'coverText' | 'coverFooter'
>;
export function BackCover({
  config,
  preview = false,
}: {
  config: Cover;
  preview?: boolean;
}) {
  if (
    !preview &&
    !config.coverBackgroundImage &&
    !config.coverQrImage &&
    !config.coverText &&
    !config.coverFooter
  )
    return null;
  return (
    <section className="back-cover" aria-label="封底页">
      {config.coverBackgroundImage && (
        <img
          className="back-cover-background"
          src={config.coverBackgroundImage}
          alt="封底底图"
        />
      )}
      <div className="back-cover-center">
        {config.coverQrImage && (
          <img
            className="back-cover-qr"
            src={config.coverQrImage}
            alt="咨询二维码"
          />
        )}
        {config.coverText && <p>{config.coverText}</p>}
      </div>
      {config.coverFooter && (
        <p className="back-cover-footer">{config.coverFooter}</p>
      )}
    </section>
  );
}
