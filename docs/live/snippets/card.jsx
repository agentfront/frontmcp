// BlogCard.tsx

export const BlogCard = ({
  author,
  date,
  title,
  link,
  img, // light image
  imgDark, // optional dark image
  time,
  draft,
  children,
}) => {
  if (draft) {
    return null;
  }
  return (
    <div className="blog-card">
      <a
        href={link}
        className="card group relative my-2 ring-2 ring-transparent rounded-2xl
                   bg-white dark:bg-background-dark
                   border border-gray-950/10 dark:border-white/10
                   overflow-hidden w-full cursor-pointer
                   hover:!border-primary dark:hover:!border-primary-light
                   flex flex-col md:flex-row" // <- force flex here
      >
        {/* IMAGE (left on desktop, full-width on mobile) */}
        <div data-component-part="card-image" className="shrink-0">
          {imgDark ? (
            <>
              {/* light mode image */}
              <img
                src={img}
                alt={title}
                className="blog-full-image light-img w-full h-full object-cover object-center not-prose"
              />
              {/* dark mode image */}
              <img
                src={imgDark}
                alt={title}
                className="blog-full-image dark-img w-full h-full object-cover object-center not-prose"
              />
            </>
          ) : (
            // single image if you don't pass imgDark
            <img src={img} alt={title} className="blog-full-image w-full h-full object-cover object-center not-prose" />
          )}
        </div>

        {/* CONTENT */}
        <div className="px-6 py-5 relative flex-1" data-component-part="card-content-container">
          {/* arrow icon */}
          <div
            id="card-link-arrow-icon"
            className="absolute text-gray-400 dark:text-gray-500
                       group-hover:text-primary dark:group-hover:text-primary-light
                       top-5 right-5"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-arrow-up-right w-4 h-4"
            >
              <path d="M7 7h10v10" />
              <path d="M7 17 17 7" />
            </svg>
          </div>

          <div style={{ height: 'calc(100% - 1.5rem)' }}>
            <div
              className="prose mt-1 font-normal text-base leading-6
                         text-gray-700 dark:text-gray-300
                         flex flex-col h-full"
              data-component-part="card-content"
            >
              <h2
                data-component-part="card-title"
                className="not-prose font-semibold text-base text-gray-800 dark:text-white group-hover:text-primary dark:group-hover:text-primary-light"
              >
                {title}
              </h2>

              {children && <span data-as="p">{children}</span>}

              <div className="flex-1" />

              <div className="blog-by text-xs font-medium text-gray-700 dark:text-gray-300 mt-4 text-right">
                <span className="date">{date}</span> · <span className="time">{time}</span> ·{' '}
                <span className="author">{author}</span>
              </div>
            </div>
          </div>
        </div>
      </a>
    </div>
  );
};
