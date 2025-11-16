export const BlogCard = ({author, date, title, link, img, time, children}) => {

    const By = ({author, date, time}) => {
        return <div className='blog-by text-xs font-medium text-gray-700 dark:text-gray-300 mt-4 text-right'>
            <span className='date'>{date}</span> · <span className='time'>{time}</span> · <span className='author'>{author}</span>
        </div>
    }

    const Title = ({children}) => {
        return <h2 data-component-part="card-title" className='font-semibold text-base text-gray-800 dark:text-white group-hover:text-primary dark:group-hover:text-primary-light'>
            {children}
        </h2>
    }
    return <div className='blog-card'>
        <Card
            img={img}
            href={link}
            arrow="true">
            <Title>{title}</Title>
            {children}
            <br/>
            <By author={author} date={date} time={time}/>
        </Card>
    </div>
}

